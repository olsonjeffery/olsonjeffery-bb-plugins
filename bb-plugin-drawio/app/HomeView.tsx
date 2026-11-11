// bb-plugin-drawio — the panel body's home state.
//
// Setup posture when no instance is configured; otherwise the jumping-off
// point: New diagram, Import XML, the vault's recent diagrams, and any
// untitled drafts the draft net is still holding.
import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import type { rpcContract, DocRef } from "../contract.js";
import { UNTITLED_PREFIX } from "../contract.js";
import type { DraftSummary, VaultFileEntry, VaultSummary } from "../contract.js";
import { SetupHint } from "./DiagramsBrowser.js";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export interface HomeViewProps {
  /** Opening a doc routes the panel body to the editor view. */
  onOpenRef: (ref: DocRef) => void;
  /** Opening a kept untitled draft routes the body to the draft editor. */
  onOpenDraft: (draftKey: string) => void;
}

export function HomeView({ onOpenRef, onOpenDraft }: HomeViewProps) {
  const rpc = useRpc<typeof rpcContract>();
  const values = useSettings().values ?? {};
  const configured = typeof values.instanceUrl === "string" && values.instanceUrl.trim() !== "";

  const [vaults, setVaults] = useState<VaultSummary[] | null>(null);
  const [files, setFiles] = useState<VaultFileEntry[] | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(() => {
    rpc
      .call("vault.list")
      .then(async (result) => {
        setVaults(result.vaults);
        const preferred =
          result.vaults.find((vault) => vault.id === (values.defaultVaultId as string)) ??
          result.vaults[0];
        if (preferred) {
          const fileResult = await rpc.call("vault.files", { vaultId: preferred.id, refresh: false });
          setFiles(fileResult.files);
        } else {
          setFiles([]);
        }
      })
      .catch(() => {
        setVaults([]);
        setFiles([]);
      });
    rpc
      .call("drafts.list")
      .then((result) => setDrafts(result.drafts.filter((draft) => draft.key.startsWith(UNTITLED_PREFIX))))
      .catch(() => setDrafts([]));
  }, [rpc, values.defaultVaultId]);

  useEffect(() => load(), [load]);
  useRealtime("drawio", load);

  const untitledDrafts = drafts ?? [];

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 md:px-5">
        {!configured ? <SetupHint /> : null}

        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 text-lg font-semibold">Diagrams</h2>
          <Button
            variant="outline"
            size="sm"
            disabled={!configured}
            onClick={() => setImportOpen(true)}
          >
            <Icon name="FileInput" className="size-3.5" />
            Import XML
          </Button>
        </div>

        {drafts !== null && untitledDrafts.length > 0 ? (
          <section className="overflow-hidden rounded-lg border border-warning/40 bg-warning/5">
            <div className="border-b border-warning/30 px-4 py-2 text-xs font-medium text-warning-foreground">
              Unsaved drafts the plugin is keeping safe
            </div>
            <ul className="divide-y divide-border/60">
              {untitledDrafts.map((draft) => (
                <li key={draft.key} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <Icon name="Workflow" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    Untitled diagram
                    <span className="ml-2 text-xs text-muted-foreground">
                      kept {new Date(draft.updatedAt).toLocaleString()}
                    </span>
                  </span>
                  <Button variant="outline" size="sm" onClick={() => onOpenDraft(draft.key)}>
                    Open
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void rpc.call("drafts.discard", { key: draft.key }).then(load, () => undefined);
                    }}
                  >
                    Discard
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">Recent vault diagrams</h3>
          {files === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : files.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No diagrams in the default vault yet.
              {configured ? " Create one with New diagram (in the browser), or open any .drawio file from a workspace." : ""}
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {files.slice(0, 12).map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-accent"
                    onClick={() => vaults !== null && onOpenRef({ kind: "vault", vaultId: vaultOf(vaults, values), path: file.path })}
                  >
                    <Icon name="Workflow" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{file.path}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(file.modifiedAtMs).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Where diagrams live</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>
              <span className="text-foreground">Docs vaults</span> — created and listed here; any
              agent can read and edit the same files with <code>bb docs</code>.
            </li>
            <li>
              <span className="text-foreground">Workspaces &amp; host paths</span> — any{" "}
              <code>.drawio</code> file in a project worktree or host directory opens in this editor
              straight from the file picker, a markdown link, or <code>bb thread open</code>.
            </li>
            <li>
              <span className="text-foreground">Drafts</span> — unsaved edits autosave here, so an
              accidental close never loses a diagram.
            </li>
          </ul>
        </section>
      </div>

      {importOpen ? (
        <ImportXmlDialog
          onClose={() => setImportOpen(false)}
          onImport={async (xml) => {
            // Untitled drafts key on a plugin-generated id the backend mints
            // per import; the key shape only needs the untitled prefix.
            const draftKey = `${UNTITLED_PREFIX}${Date.now().toString(36)}-${Math.random()
              .toString(36)
              .slice(2, 8)}`;
            await rpc.call("drafts.put", { key: draftKey, content: xml });
            setImportOpen(false);
            onOpenDraft(draftKey);
          }}
        />
      ) : null}
    </div>
  );
}

function vaultOf(vaults: VaultSummary[], values: Record<string, unknown>): string {
  const preferred = vaults.find((vault) => vault.id === values.defaultVaultId) ?? vaults[0];
  return preferred?.id ?? "";
}

function ImportXmlDialog({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (xml: string) => Promise<void>;
}) {
  const [xml, setXml] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const looksValid = xml.includes("<mxfile") || xml.includes("<mxGraphModel") || xml.includes("<mxCell");

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import draw.io XML</DialogTitle>
          <DialogDescription>
            The XML opens as an unsaved draft; save it into a vault with Save as… afterwards.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={xml}
          onChange={(event) => setXml(event.target.value)}
          placeholder={'<mxfile>…</mxfile> — or paste a fresh <mxGraphModel> snippet'}
          className="min-h-40 font-mono text-xs"
        />
        {xml.trim() !== "" && !looksValid ? (
          <p className="text-xs text-muted-foreground">
            This doesn't look like draw.io XML — check for a complete &lt;mxfile&gt; element.
          </p>
        ) : null}
        {error !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || xml.trim() === ""}
            onClick={() => {
              setPending(true);
              setError(null);
              onImport(xml)
                .catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : String(cause));
                })
                .finally(() => setPending(false));
            }}
          >
            {pending ? "Importing…" : "Open as draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
