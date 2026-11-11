// bb-plugin-drawio — the diagram view.
//
// The shell every surface mounts: loads the document through its
// DocumentSource, keeps the dirty/save state, autosaves to the drafts table,
// drives Save / Save As / Export, and never clobbers on conflict — a CAS
// mismatch opens the reload-or-overwrite dialog instead.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract, DocRef } from "../contract.js";
import { STARTER_XML } from "../contract.js";
import { DrawioEditor } from "./DrawioEditor.js";
import type { DrawioEditorHandle } from "./DrawioEditor.js";
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
  /** Compact toolbars for narrow tab surfaces. */
  compact?: boolean;
  className?: string;
}

interface ReadyLoad {
  state: "ready";
  content: string;
  sha256: string | null;
  /** A draft that differs from the saved copy (kept unsaved work). */
  recovery: { content: string; updatedAt: number } | null;
}

export function DiagramView({ refValue, starterXml, onSavedAs, compact, className }: DiagramViewProps) {
  const rpc = useRpc<typeof rpcContract>();
  const values = useSettings().values ?? {};
  const adapter = useMemo(() => sourceFor(refValue), [refValue]);

  const [load, setLoad] = useState<
    { state: "loading" } | { state: "error"; message: string } | ReadyLoad
  >({ state: "loading" });

  const reload = useCallback(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    adapter
      .load(rpc)
      .then(async (doc) => {
        let recovery: { content: string; updatedAt: number } | null = null;
        if (!doc.untitled) {
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
        if (!cancelled) {
          setLoad({ state: "error", message: cause instanceof Error ? cause.message : String(cause) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [adapter, rpc, starterXml]);

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
  useDraftAutosave(rpc, dirty && !adapter.untitled ? draftKey : null, editorXml, dirty);

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
    [adapter, rpc],
  );

  const save = useCallback(() => {
    if (load.state !== "ready" || !dirty || saving) return;
    void applySave(adapter.save(rpc, editorXml, load.sha256));
  }, [load, dirty, saving, applySave, adapter, rpc, editorXml]);

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
      if (editor === null || load.state !== "ready") return;
      try {
        const result = await editor.exportDiagram(format);
        downloadExport(result, exportFilename(adapter.title(), format));
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [adapter, load.state],
  );

  const copyPng = useCallback(async () => {
    const editor = editorRef.current;
    if (editor === null || load.state !== "ready") return;
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
  }, [load.state]);

  if (load.state !== "ready") {
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
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <DiagramToolbar
        title={adapter.title()}
        subtitle={adapterSubtitle(adapter)}
        dirty={dirty}
        saving={saving}
        untitled={adapter.untitled}
        compact={compact === true}
        onSave={save}
        onExport={(format) => void exportAs(format)}
        onCopyPng={() => void copyPng()}
        onSaveAs={adapter.untitled ? () => setSaveAsOpen(true) : undefined}
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

      {load.recovery !== null ? (
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

      <DrawioEditor
        ref={editorRef}
        instanceUrl={instanceUrl}
        uiTheme={uiTheme}
        xml={load.content}
        onXml={markXml}
        onReady={() => undefined}
        className="min-h-0"
      />
    </div>
  );
}

function adapterSubtitle(adapter: { untitled: boolean; ref: unknown }): string | null {
  if (adapter.untitled) return "not saved yet";
  const ref = adapter.ref as DocRef;
  return ref.kind === "vault" ? `vault · ${ref.path}` : null;
}

// ---------------------------------------------------------------------------

function DiagramToolbar({
  title,
  subtitle,
  dirty,
  saving,
  untitled,
  compact,
  onSave,
  onExport,
  onCopyPng,
  onSaveAs,
}: {
  title: string;
  subtitle: string | null;
  dirty: boolean;
  saving: boolean;
  untitled: boolean;
  compact: boolean;
  onSave: () => void;
  onExport: (format: ExportFormat) => void;
  onCopyPng: () => void;
  onSaveAs: (() => void) | undefined;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
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
        {subtitle !== null && !compact ? (
          <span className="hidden truncate text-xs text-muted-foreground md:inline">{subtitle}</span>
        ) : null}
      </div>
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
