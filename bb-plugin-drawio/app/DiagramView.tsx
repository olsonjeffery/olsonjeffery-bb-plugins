// bb-plugin-drawio — the diagram view.
//
// The shell every surface mounts: loads the document through its
// DocumentSource, keeps the dirty/save state, autosaves to the drafts table,
// drives Save / Save As / Export, and never clobbers on conflict — a CAS
// mismatch opens the reload-or-overwrite dialog instead.
//
// Two render modes: the embed editor (dashboard surfaces) and the read-only
// static viewer (sidebar surfaces — thread tabs, the fileOpener). Read-only
// has no editing surface at all; its toolbar reloads from disk and hands off
// to the dashboard via onOpenInEditor instead of unlocking in place.
//
// A fullscreen toggle lifts the whole surface (toolbar + frame) to the
// viewport: the Fullscreen API when the browser has it, otherwise a fixed
// overlay that still sits below bb's dialogs so they keep working.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useRpc,
  useSettings,
  experimental_PluginRpcCallError,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract, DocRef } from "../contract.js";
import { STARTER_XML } from "../contract.js";
import { DrawioEditor } from "./DrawioEditor.js";
import type { DrawioEditorHandle } from "./DrawioEditor.js";
import { DrawioViewer } from "./DrawioViewer.js";
import {
  dataUriToBytes,
  downloadExport,
  exportFilename,
  type ExportFormat,
} from "./drawio.js";
import { sourceFor, useDraftAutosave, type SaveResult } from "./source.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

/** Where "Save As" hands control back to the hosting surface. */
export interface DiagramViewProps {
  /** The document identity. Draft refs open untitled drafts. */
  refValue: DocRef | { kind: "draft"; draftKey: string };
  /** Starter content for a fresh untitled draft that has no draft row yet. */
  starterXml?: string;
  /** Called after Save As created a saved document (the surface re-targets). */
  onSavedAs?: (ref: DocRef) => void;
  /** Called from the not-found state to leave the dead link (body only). */
  onBack?: () => void;
  /**
   * Render the static read-only viewer instead of the embed editor. There is
   * no in-place unlock: editing happens in the dashboard, reached through
   * `onOpenInEditor`.
   */
  readOnly?: boolean;
  /** Opens this document on the dashboard's editable body route. */
  onOpenInEditor?: () => void;
  /** Compact toolbars for narrow tab surfaces. */
  compact?: boolean;
  className?: string;
}

/** The document-level fullscreen element, with the webkit-prefixed fallback. */
function fullscreenElement(): Element | null {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

interface ReadyLoad {
  state: "ready";
  content: string;
  sha256: string | null;
  /** A draft that differs from the saved copy (kept unsaved work). */
  recovery: { content: string; updatedAt: number } | null;
}

export function DiagramView({ refValue, starterXml, onSavedAs, onBack, readOnly, onOpenInEditor, compact, className }: DiagramViewProps) {
  const rpc = useRpc<typeof rpcContract>();
  const values = useSettings().values ?? {};
  const adapter = useMemo(() => sourceFor(refValue), [refValue]);
  const readOnlySurface = readOnly === true;

  const [load, setLoad] = useState<
    | { state: "loading" }
    | { state: "error"; message: string }
    | { state: "not-found"; message: string }
    | ReadyLoad
  >({ state: "loading" });

  const reload = useCallback(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    adapter
      .load(rpc)
      .then(async (doc) => {
        let recovery: { content: string; updatedAt: number } | null = null;
        // Recovery is an editing affordance; the read-only viewer never shows
        // it (the dashboard offers the kept draft when opened there).
        if (!doc.untitled && !readOnlySurface) {
          try {
            const { draft } = await rpc.call("drafts.get", { key: doc.draftKey });
            if (draft !== null && draft.content !== doc.content) {
              recovery = { content: draft.content, updatedAt: draft.updatedAt };
            }
          } catch {
            // Recovery is a nicety; a failed draft read never blocks the doc.
          }
        }
        if (cancelled) return;
        setLoad({
          state: "ready",
          content: doc.untitled && doc.content === "" ? (starterXml ?? STARTER_XML) : doc.content,
          sha256: doc.sha256,
          recovery,
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof experimental_PluginRpcCallError && cause.code === "not_found") {
          setLoad({ state: "not-found", message: cause.message });
        } else {
          setLoad({ state: "error", message: cause instanceof Error ? cause.message : String(cause) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, rpc, starterXml, readOnlySurface]);

  useEffect(() => reload(), [reload]);

  // Live editor state
  const editorRef = useRef<DrawioEditorHandle | null>(null);
  const [editorXml, setEditorXml] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<{ currentSha256: string | null } | null>(null);
  const [saveAsOpen, setSaveAsOpen] = useState(false);

  // Hooks stay above any early return; guards below check load state instead.
  const draftKey = adapter.draftKey;
  useDraftAutosave(
    rpc,
    dirty && !readOnlySurface && !adapter.untitled ? draftKey : null,
    editorXml,
    dirty && !readOnlySurface,
  );

  // Fullscreen: the whole surface (toolbar + frame) lifted to the viewport.
  // The Fullscreen API is used when the browser has it (top layer above all
  // chrome); otherwise the surface becomes a fixed overlay that sits BELOW
  // bb's dialogs (z-40 < z-50) so they keep working over it.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const exitFullscreen = useCallback(() => {
    const doc = document as Document & { webkitExitFullscreen?: () => void };
    if (fullscreenElement() !== null && typeof document.exitFullscreen === "function") {
      void document.exitFullscreen().catch(() => undefined);
    } else if (
      fullscreenElement() !== null &&
      typeof doc.webkitExitFullscreen === "function"
    ) {
      doc.webkitExitFullscreen();
    } else {
      setFullscreen(false); // the fixed-overlay fallback path
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    // The state — not the document element — drives the decision: in the
    // fixed-overlay fallback there is no fullscreen element to check, so the
    // state is the only record that the lift is active.
    if (fullscreen) {
      exitFullscreen();
      return;
    }
    const surface = rootRef.current as
      | (HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void })
      | null;
    if (surface === null) return;
    if (typeof surface.requestFullscreen === "function") {
      // Denied (or an unpromising old build) → the fixed-overlay fallback.
      surface.requestFullscreen().catch(() => setFullscreen(true));
    } else if (typeof surface.webkitRequestFullscreen === "function") {
      const result = surface.webkitRequestFullscreen();
      if (result !== undefined && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => setFullscreen(true));
      }
    } else {
      setFullscreen(true); // no Fullscreen API: fixed overlay
    }
  }, [fullscreen, exitFullscreen]);

  // Tracks native transitions (the toggle button, Escape) for this surface.
  useEffect(() => {
    const sync = () => setFullscreen(fullscreenElement() === rootRef.current);
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  // Escape leaves the fixed-overlay fallback; native fullscreen handles its own.
  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && fullscreenElement() === null) setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  // Unmounting while this surface is the native fullscreen element → leave.
  useEffect(
    () => () => {
      if (fullscreenElement() !== null) exitFullscreen();
    },
    [exitFullscreen],
  );

  // The XML the saved copy is known to hold; dirty = editor diverges from it.
  // (draw.io keeps firing save/autosave events after a save, so dirty must be
  // a comparison against the saved content, never a one-way latch.)
  const savedXmlRef = useRef<string>("");
  savedXmlRef.current = load.state === "ready" ? load.content : savedXmlRef.current;
  const editorXmlRef = useRef<string>("");

  const markXml = useCallback((xml: string) => {
    editorXmlRef.current = xml;
    setEditorXml(xml);
    setDirty(xml !== savedXmlRef.current);
  }, []);

  const applySave = useCallback(
    async (result: Promise<SaveResult>) => {
      setSaving(true);
      try {
        const outcome = await result;
        if (outcome.outcome === "conflict") {
          // The dialog is portaled outside a native top layer; drop the
          // fullscreen lift so it is visible and interactive.
          exitFullscreen();
          setConflict({ currentSha256: outcome.currentSha256 });
          return false;
        }
        // A real save retires the draft net; untitled drafts keep theirs (it
        // IS the storage until Save As).
        if (!adapter.untitled) {
          void rpc.call("drafts.discard", { key: adapter.draftKey }).catch(() => undefined);
        }
        savedXmlRef.current = editorXmlRef.current;
        setDirty(editorXmlRef.current !== savedXmlRef.current);
        toast.success("Saved");
        return true;
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [adapter, rpc, exitFullscreen],
  );

  const save = useCallback(() => {
    if (readOnlySurface || load.state !== "ready" || !dirty || saving) return;
    void applySave(adapter.save(rpc, editorXml, load.sha256));
  }, [readOnlySurface, load, dirty, saving, applySave, adapter, rpc, editorXml]);

  const openSaveAs = useCallback(() => {
    // Same portal consideration as the conflict dialog above.
    exitFullscreen();
    setSaveAsOpen(true);
  }, [exitFullscreen]);

  // Ctrl/Cmd+S saves like the editor's own Ctrl+S does.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [save]);

  const exportAs = useCallback(
    async (format: ExportFormat) => {
      const editor = editorRef.current;
      if (readOnlySurface || editor === null || load.state !== "ready") return;
      try {
        const result = await editor.exportDiagram(format);
        downloadExport(result, exportFilename(adapter.title(), format));
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [adapter, load.state, readOnlySurface],
  );

  const copyPng = useCallback(async () => {
    const editor = editorRef.current;
    if (readOnlySurface || editor === null || load.state !== "ready") return;
    try {
      const result = await editor.exportDiagram("png");
      const bytes = result.dataUri === null ? null : dataUriToBytes(result.dataUri);
      if (bytes === null) throw new Error("The editor returned no PNG data.");
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }),
        }),
      ]);
      toast.success("PNG copied to the clipboard");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  }, [load.state, readOnlySurface]);

  if (load.state !== "ready") {
    if (load.state === "not-found") {
      return (
        <div className={cn("flex min-h-0 flex-1 items-center justify-center p-6", className)}>
          <div className="max-w-md text-center text-sm text-muted-foreground">
            <Icon name="FileQuestion" className="mx-auto mb-2 size-5 text-muted-foreground" />
            <p className="font-medium text-foreground">This diagram does not exist</p>
            <p className="mt-1">{load.message}</p>
            <p className="mt-1">
              It was deleted elsewhere (another window or an agent), or this is a stale link.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              {onBack ? (
                <Button variant="outline" size="sm" onClick={onBack}>
                  <Icon name="ArrowLeft" className="size-3.5" />
                  All diagrams
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={reload}>
                Retry
              </Button>
            </div>
          </div>
        </div>
      );
    }
    if (load.state === "error") {
      return (
        <div className={cn("flex min-h-0 flex-1 items-center justify-center p-6", className)}>
          <div className="max-w-md text-center text-sm text-muted-foreground">
            <Icon name="AlertCircle" className="mx-auto mb-2 size-5 text-destructive" />
            <p>{load.message}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
              Retry
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className={cn("flex min-h-0 flex-1 items-center justify-center p-6", className)}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loading" className="size-4 animate-spin" />
          Loading diagram…
        </div>
      </div>
    );
  }

  // load is a ReadyLoad from here on — the editor surface.

  const instanceUrl = values.instanceUrl as string;
  const uiTheme = (values.uiTheme as "min" | "sketch" | "atlas") ?? "min";

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex min-h-0 flex-1 flex-col bg-background",
        fullscreen && "fixed inset-0 z-40",
        className,
      )}
    >
      <DiagramToolbar
        title={adapter.title()}
        subtitle={adapterSubtitle(adapter, readOnlySurface)}
        dirty={dirty}
        saving={saving}
        untitled={adapter.untitled}
        readOnly={readOnlySurface}
        compact={compact === true}
        fullscreen={fullscreen}
        onBack={onBack}
        onSave={save}
        onOpenInEditor={onOpenInEditor}
        onReload={reload}
        onExport={(format) => void exportAs(format)}
        onCopyPng={() => void copyPng()}
        onSaveAs={adapter.untitled && !readOnlySurface ? openSaveAs : undefined}
        onToggleFullscreen={toggleFullscreen}
      />

      {conflict !== null ? (
        <ConflictDialog
          onReload={() => {
            // The user's edit survives in the drafts net; reload the saved copy.
            if (!adapter.untitled) {
              void rpc.call("drafts.put", { key: adapter.draftKey, content: editorXml }).catch(
                () => undefined,
              );
            }
            setConflict(null);
            setDirty(false);
            editorXmlRef.current = "";
            setEditorXml("");
            reload();
          }}
          onOverwrite={() => {
            setConflict(null);
            void applySave(adapter.save(rpc, editorXml, null));
          }}
          onClose={() => setConflict(null)}
        />
      ) : null}

      {!readOnlySurface && load.recovery !== null ? (
        <RecoveryBanner
          updatedAt={load.recovery.updatedAt}
          onRestore={() => {
            if (load.recovery === null) return;
            markXml(load.recovery.content);
            setLoad({ ...load, recovery: null });
          }}
          onDiscard={() => {
            void rpc.call("drafts.discard", { key: adapter.draftKey }).catch(() => undefined);
            setLoad({ ...load, recovery: null });
          }}
        />
      ) : null}

      {saveAsOpen ? (
        <SaveAsDialog
          defaultFolder={typeof values.defaultFolder === "string" ? values.defaultFolder : "diagrams"}
          preferredVaultId={typeof values.defaultVaultId === "string" ? values.defaultVaultId : ""}
          onClose={() => setSaveAsOpen(false)}
          onCreate={async (vaultId, path) => {
            const result = await rpc.call("vault.create", {
              vaultId,
              path,
              content: editorXml,
            });
            if (result.outcome === "conflict") {
              throw new Error("That file already exists. Pick another name.");
            }
            if (!adapter.untitled) {
              void rpc.call("drafts.discard", { key: adapter.draftKey }).catch(() => undefined);
            }
            setSaveAsOpen(false);
            savedXmlRef.current = editorXml;
            setDirty(false);
            setEditorXml("");
            toast.success("Saved");
            onSavedAs?.({ kind: "vault", vaultId, path });
          }}
        />
      ) : null}

      {readOnlySurface ? (
        <DrawioViewer instanceUrl={instanceUrl} xml={load.content} className="min-h-0" />
      ) : (
        <DrawioEditor
          ref={editorRef}
          instanceUrl={instanceUrl}
          uiTheme={uiTheme}
          xml={load.content}
          onXml={markXml}
          onReady={() => undefined}
          className="min-h-0"
        />
      )}
    </div>
  );
}

function adapterSubtitle(adapter: { untitled: boolean; ref: unknown }, readOnly: boolean): string | null {
  if (adapter.untitled) return "not saved yet";
  const ref = adapter.ref as DocRef;
  const where = ref.kind === "vault" ? `vault · ${ref.path}` : null;
  return readOnly ? "read-only" : where;
}

// ---------------------------------------------------------------------------

function DiagramToolbar({
  title,
  subtitle,
  dirty,
  saving,
  untitled,
  readOnly,
  compact,
  fullscreen,
  onBack,
  onSave,
  onOpenInEditor,
  onReload,
  onExport,
  onCopyPng,
  onSaveAs,
  onToggleFullscreen,
}: {
  title: string;
  subtitle: string | null;
  dirty: boolean;
  saving: boolean;
  untitled: boolean;
  readOnly: boolean;
  compact: boolean;
  fullscreen: boolean;
  /** Back affordance for surfaces stacked above a list (the plugin body). */
  onBack: (() => void) | undefined;
  onSave: () => void;
  onOpenInEditor: (() => void) | undefined;
  onReload: () => void;
  onExport: (format: ExportFormat) => void;
  onCopyPng: () => void;
  onSaveAs: (() => void) | undefined;
  onToggleFullscreen: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
      {onBack !== undefined ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 px-1.5 text-muted-foreground hover:text-foreground"
            onClick={onBack}
            aria-label="All diagrams"
          >
            <Icon name="ArrowLeft" className="size-3.5" />
            {!compact ? <span className="pr-1 text-xs">All diagrams</span> : null}
          </Button>
          <div className="h-4 w-px shrink-0 bg-border" aria-hidden />
        </>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Icon name="Workflow" className="size-4 shrink-0 text-muted-foreground" />
        <span className={cn("truncate font-medium", compact ? "text-xs" : "text-sm")}>{title}</span>
        {dirty ? (
          <span
            className="size-2 shrink-0 rounded-full bg-warning"
            title="Unsaved changes (a draft autosaves them)"
            aria-label="Unsaved changes"
          />
        ) : null}
        {subtitle !== null && (!compact || readOnly) ? (
          // "read-only" always shows (it is the surface's contract); the
          // editable location subtitle yields space on narrow surfaces.
          <span
            className={cn(
              "truncate text-xs text-muted-foreground",
              !readOnly && "hidden md:inline",
            )}
          >
            {subtitle}
          </span>
        ) : null}
      </div>
      {readOnly ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="px-2"
            onClick={onReload}
            aria-label="Reload from disk"
          >
            <Icon name="ArrowReloadHorizontal" className="size-3.5" />
          </Button>
          {onOpenInEditor !== undefined ? (
            <Button variant="outline" size="sm" onClick={onOpenInEditor}>
              <Icon name="Edit" className="size-3.5" />
              Open in editor
            </Button>
          ) : null}
        </>
      ) : (
        <>
          {untitled && onSaveAs !== undefined ? (
            <Button variant="outline" size="sm" onClick={onSaveAs} disabled={saving}>
              <Icon name="Save" className="size-3.5" />
              Save as…
            </Button>
          ) : null}
          <Button variant={dirty ? "default" : "outline"} size="sm" onClick={onSave} disabled={saving || !dirty}>
            <Icon name={saving ? "Loading" : "Save"} className={cn("size-3.5", saving && "animate-spin")} />
            Save
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Icon name="Download" className="size-3.5" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Download</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => onExport("png")}>PNG image</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport("jpeg")}>JPEG image</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport("svg")}>SVG vector</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport("pdf")}>PDF document</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport("xmlpng")}>PNG with embedded XML</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExport("xml")}>draw.io XML</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onCopyPng}>Copy PNG to clipboard</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <Button
        variant="outline"
        size="sm"
        className="px-2"
        onClick={onToggleFullscreen}
        aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        <Icon name={fullscreen ? "Minimize2" : "Maximize2"} className="size-3.5" />
      </Button>
    </div>
  );
}

function ConflictDialog({
  onReload,
  onOverwrite,
  onClose,
}: {
  onReload: () => void;
  onOverwrite: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>This diagram changed elsewhere</DialogTitle>
          <DialogDescription>
            The saved copy was updated by another window or an agent while you were editing. Your
            edit is kept as a draft; nothing is overwritten silently.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep editing
          </Button>
          <Button variant="outline" onClick={onReload}>
            Reload saved copy
          </Button>
          <Button variant="destructive" onClick={onOverwrite}>
            Overwrite saved copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecoveryBanner({
  updatedAt,
  onRestore,
  onDiscard,
}: {
  updatedAt: number;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-warning/10 px-3 py-1.5 text-xs">
      <Icon name="History" className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        Unsaved changes from {new Date(updatedAt).toLocaleString()} were kept as a draft.
      </span>
      <Button variant="outline" size="sm" onClick={onRestore}>
        Restore draft
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Discard
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard the kept draft?</DialogTitle>
            <DialogDescription>The draft's content is removed. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                onDiscard();
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SaveAsDialog({
  defaultFolder,
  preferredVaultId,
  onClose,
  onCreate,
}: {
  defaultFolder: string;
  preferredVaultId: string;
  onClose: () => void;
  onCreate: (vaultId: string, path: string) => Promise<void>;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [vaults, setVaults] = useState<Array<{ id: string; name: string }> | null>(null);
  const [vaultId, setVaultId] = useState<string>("");
  const [name, setName] = useState("Untitled diagram");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc
      .call("vault.list")
      .then((result) => {
        if (cancelled) return;
        setVaults(result.vaults);
        const preferred =
          result.vaults.find((vault) => vault.id === preferredVaultId) ?? result.vaults[0];
        setVaultId(preferred?.id ?? "");
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
    // The vault list is read once per dialog open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const folder = defaultFolder.replace(/^\/+|\/+$/g, "");
  const cleanName = name.trim().replace(/\.drawio$/i, "");
  const path = folder === "" ? `${cleanName}.drawio` : `${folder}/${cleanName}.drawio`;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save diagram to a vault</DialogTitle>
          <DialogDescription>
            The diagram is stored as a <code>.drawio</code> file in one of your Docs vaults.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Architecture overview"
              autoFocus
            />
            {folder !== "" ? (
              <span className="block text-xs text-muted-foreground">Saved to {path}</span>
            ) : null}
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Vault</span>
            <select
              value={vaultId}
              onChange={(event) => setVaultId(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              disabled={vaults === null || vaults.length === 0}
            >
              {vaults === null ? <option>Loading vaults…</option> : null}
              {(vaults ?? []).map((vault) => (
                <option key={vault.id} value={vault.id}>
                  {vault.name}
                </option>
              ))}
            </select>
            {vaults !== null && vaults.length === 0 ? (
              <span className="block text-xs text-destructive">
                No Docs vaults found. Create one under Docs first.
              </span>
            ) : null}
          </label>
          {error !== null ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || vaultId === "" || cleanName === ""}
            onClick={() => {
              setPending(true);
              setError(null);
              onCreate(vaultId, path)
                .catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : String(cause));
                })
                .finally(() => setPending(false));
            }}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
