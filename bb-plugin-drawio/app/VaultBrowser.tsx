// bb-plugin-drawio — the Docs-vault browser.
//
// A complete vault file browser (every file type — bb's own Docs browser
// lists Markdown/HTML only, so .drawio and everything else would be
// invisible there), shared by the left sidebar (experimental_sidebar) and
// the "Vault browser" right-panel window tab. Diagrams open in the embedded
// editor; other files open in BB's built-in preview; everything can be
// deleted (with a confirm), which keeps the vault honest from both panes.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useRealtime,
  useRpc,
  useSettings,
  useSdk,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "../contract.js";
import { STARTER_XML } from "../contract.js";
import type { DocRef, VaultFileEntry, VaultSummary } from "../contract.js";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export interface VaultBrowserProps {
  variant: "sidebar" | "panel";
  /** Opening a diagram means on this surface (body navigation / tab opening). */
  onOpenDiagram: (ref: DocRef) => void;
  /** Only the panel variant has a controller that can open action tabs. */
  onOpenDiagramInTab?: (ref: DocRef) => void;
}

interface FolderNode {
  name: string;
  files: VaultFileEntry[];
  folders: Map<string, FolderNode>;
}

export function VaultBrowser({ variant, onOpenDiagram, onOpenDiagramInTab }: VaultBrowserProps) {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const { values } = useSettings();
  const [vaults, setVaults] = useState<VaultSummary[] | null>(null);
  const [vaultId, setVaultId] = useState<string>("");
  const [files, setFiles] = useState<VaultFileEntry[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VaultFileEntry | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const configured = typeof values?.instanceUrl === "string" && values.instanceUrl.trim() !== "";
  const preferredVault = typeof values?.defaultVaultId === "string" ? values.defaultVaultId : "";

  const loadVaults = useCallback(() => {
    rpc
      .call("vault.list")
      .then((result) => {
        setVaults(result.vaults);
        setVaultId((current) => {
          if (current !== "" && result.vaults.some((vault) => vault.id === current)) return current;
          const preferred =
            result.vaults.find((vault) => vault.id === preferredVault) ?? result.vaults[0];
          return preferred?.id ?? "";
        });
      })
      .catch(() => setVaults([]));
  }, [rpc, preferredVault]);

  useEffect(() => loadVaults(), [loadVaults]);

  const loadFiles = useCallback(
    (refresh: boolean) => {
      if (vaultId === "") {
        setFiles(null);
        return;
      }
      if (refresh) setRefreshing(true);
      rpc
        .call("vault.files", { vaultId, refresh })
        .then((result) => {
          setFiles(result.files);
          setFilesError(null);
          setRefreshing(false);
        })
        .catch((cause: unknown) => {
          setFiles(null);
          setFilesError(cause instanceof Error ? cause.message : String(cause));
          setRefreshing(false);
        });
    },
    [rpc, vaultId],
  );

  useEffect(() => loadFiles(false), [loadFiles]);
  useRealtime("drawio", () => loadFiles(false));

  // First-level folders start expanded so the file list is one glance away;
  // once the user collapses anything, their choices win.
  useEffect(() => {
    if (files === null) return;
    setExpanded((current) => {
      if (current.size > 0) return current;
      const topLevel = new Set<string>();
      for (const file of files) {
        const [first, second] = file.path.split("/");
        if (second !== undefined) topLevel.add(first);
      }
      return topLevel.size > 0 ? topLevel : current;
    });
  }, [files]);

  const tree = useMemo(() => buildTree(files ?? []), [files]);

  const openFile = useCallback(
    (file: VaultFileEntry) => {
      const vault = (vaults ?? []).find((candidate) => candidate.id === vaultId);
      if (vault === undefined) return;
      // BB's built-in preview takes a live host-file target; a vault's hostId
      // of null means the server machine (its primary host).
      void (async () => {
        const primaryHostId = (await sdk.system.config()).primaryHostId;
        const hostId = vault.hostId ?? primaryHostId;
        if (!hostId) {
          toast.error("No host is known for this vault's files.");
          return;
        }
        navigate.experimental_openFilePreview({
          target: { kind: "host", hostId, path: `${vault.rootPath}/${file.path}` },
          location: null,
        });
      })();
    },
    [navigate, sdk, vaultId, vaults],
  );

  const openRow = useCallback(
    (file: VaultFileEntry) => {
      if (file.path.toLowerCase().endsWith(".drawio")) {
        onOpenDiagram({ kind: "vault", vaultId, path: file.path });
      } else {
        openFile(file);
      }
    },
    [onOpenDiagram, openFile, vaultId],
  );

  const confirmDelete = useCallback(async () => {
    if (deleteTarget === null) return;
    try {
      await rpc.call("vault.delete", { vaultId, path: deleteTarget.path });
      toast.success(`Deleted ${deleteTarget.path}`);
      setDeleteTarget(null);
      loadFiles(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    }
  }, [deleteTarget, loadFiles, rpc, vaultId]);

  if (!configured) {
    return (
      <BrowserShell variant={variant}>
        <SetupHint />
      </BrowserShell>
    );
  }

  return (
    <BrowserShell variant={variant}>
      <div className="flex items-center gap-1.5">
        <select
          value={vaultId}
          onChange={(event) => setVaultId(event.target.value)}
          aria-label="Vault"
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
        >
          {vaults === null ? <option value="">Loading…</option> : null}
          {(vaults ?? []).map((vault) => (
            <option key={vault.id} value={vault.id}>
              {vault.name}
            </option>
          ))}
          {vaults !== null && vaults.length === 0 ? <option value="">No vaults</option> : null}
        </select>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label="Refresh file list"
          disabled={refreshing || vaultId === ""}
          onClick={() => loadFiles(true)}
        >
          <Icon name={refreshing ? "Loading" : "RefreshCw"} className={cn("size-3.5", refreshing && "animate-spin")} />
        </Button>
      </div>
      <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setNewOpen(true)}>
        <Icon name="Plus" className="size-3.5" />
        New diagram
      </Button>

      {filesError !== null ? (
        <p role="alert" className="px-1 text-xs text-destructive">
          {filesError}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {files === null && vaultId !== "" ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">Loading files…</p>
        ) : null}
        {files !== null && files.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            This vault is empty. Diagrams created here appear as .drawio files.
          </p>
        ) : null}
        {[...tree.folders.values()].map((node) => (
          <FolderRow
            key={node.name}
            node={node}
            depth={0}
            prefix=""
            vaultId={vaultId}
            expanded={expanded}
            toggle={(path) =>
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(path)) {
                  next.delete(path);
                } else {
                  next.add(path);
                }
                return next;
              })
            }
            onOpen={openRow}
            onOpenInTab={onOpenDiagramInTab}
            onOpenPlain={openFile}
            onDelete={setDeleteTarget}
          />
        ))}
        {tree.files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            depth={0}
            vaultId={vaultId}
            onOpen={openRow}
            onOpenInTab={onOpenDiagramInTab}
            onOpenPlain={openFile}
            onDelete={setDeleteTarget}
          />
        ))}
      </div>

      {newOpen ? (
        <NewDiagramDialog
          vaults={vaults ?? []}
          initialVaultId={vaultId}
          defaultFolder={typeof values?.defaultFolder === "string" ? values.defaultFolder : "diagrams"}
          onClose={() => setNewOpen(false)}
          onCreate={async (targetVaultId, path) => {
            const result = await rpc.call("vault.create", {
              vaultId: targetVaultId,
              path,
              content: STARTER_XML,
            });
            if (result.outcome === "conflict") {
              throw new Error("That file already exists. Pick another name.");
            }
            setNewOpen(false);
            loadFiles(false);
            onOpenDiagram({ kind: "vault", vaultId: targetVaultId, path });
          }}
        />
      ) : null}

      {deleteTarget !== null ? (
        <DeleteDialog
          path={deleteTarget.path}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </BrowserShell>
  );
}

function BrowserShell({ variant, children }: { variant: "sidebar" | "panel"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-2 p-2",
        variant === "panel" && "bg-card",
      )}
    >
      {children}
    </div>
  );
}

export function SetupHint() {
  return (
    <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">Set up your draw.io instance</p>
      <p className="mt-1">
        Point Drawio at a self-hosted draw.io webapp under Settings → Plugins → Drawio (or{" "}
        <code>bb plugin config drawio set instanceUrl &lt;url&gt;</code>). The official{" "}
        <code>jgraph/drawio</code> Docker image works as-is — see the plugin's{" "}
        <code>deploy/</code> for a systemd unit.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree rendering
// ---------------------------------------------------------------------------

interface RowActions {
  vaultId: string;
  onOpen: (file: VaultFileEntry) => void;
  /** Opening a non-diagram in BB's preview (rows that are not diagrams). */
  onOpenPlain: (file: VaultFileEntry) => void;
  onOpenInTab?: (ref: DocRef) => void;
  onDelete: (file: VaultFileEntry) => void;
}

function FolderRow({
  node,
  depth,
  prefix,
  vaultId,
  expanded,
  toggle,
  onOpen,
  onOpenPlain,
  onOpenInTab,
  onDelete,
}: {
  node: FolderNode;
  depth: number;
  prefix: string;
  expanded: Set<string>;
  toggle: (path: string) => void;
} & RowActions) {
  const path = prefix === "" ? node.name : `${prefix}/${node.name}`;
  const isOpen = expanded.has(path);
  const hasChildren = node.folders.size > 0 || node.files.length > 0;
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-left text-xs font-medium hover:bg-accent"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => toggle(path)}
        aria-expanded={hasChildren ? isOpen : undefined}
      >
        <Icon name={isOpen ? "ChevronDown" : "ChevronRight"} className="size-3 shrink-0 text-muted-foreground" />
        <Icon name="Folder" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
      {isOpen ? (
        <div>
          {[...node.folders.values()].map((child) => (
            <FolderRow
              key={child.name}
              node={child}
              depth={depth + 1}
              prefix={path}
              vaultId={vaultId}
              expanded={expanded}
              toggle={toggle}
              onOpen={onOpen}
              onOpenPlain={onOpenPlain}
              onOpenInTab={onOpenInTab}
              onDelete={onDelete}
            />
          ))}
          {node.files.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              depth={depth + 1}
              vaultId={vaultId}
              onOpen={onOpen}
              onOpenPlain={onOpenPlain}
              onOpenInTab={onOpenInTab}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function fileGlyph(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".drawio")) return "Workflow";
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".html")) return "FileText";
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return "Image";
  return "File";
}

function FileRow({
  file,
  depth,
  vaultId,
  onOpen,
  onOpenPlain,
  onOpenInTab,
  onDelete,
}: { file: VaultFileEntry; depth: number } & RowActions) {
  const isDiagram = file.path.toLowerCase().endsWith(".drawio");
  const title = fileName(file.path);
  return (
    <div className="group/row flex items-center gap-0.5 rounded-md pr-1 hover:bg-accent" style={{ paddingLeft: `${depth * 12 + 4}px` }}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-xs"
        onClick={() => onOpen(file)}
        title={file.path}
      >
        <Icon name={fileGlyph(file.path)} className={cn("size-3.5 shrink-0", isDiagram ? "text-foreground/80" : "text-muted-foreground")} />
        <span className="min-w-0 truncate">{title}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
            aria-label={`Actions for ${title}`}
          >
            <Icon name="MoreHorizontal" className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {isDiagram ? (
            <>
              <DropdownMenuItem onSelect={() => onOpen(file)}>Open</DropdownMenuItem>
              {onOpenInTab !== undefined ? (
                <DropdownMenuItem
                  onSelect={() => onOpenInTab({ kind: "vault", vaultId, path: file.path })}
                >
                  Open in tab
                </DropdownMenuItem>
              ) : null}
            </>
          ) : (
            <DropdownMenuItem onSelect={() => onOpenPlain(file)}>Open in preview</DropdownMenuItem>
          )}
          <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(file)}>
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function buildTree(files: VaultFileEntry[]): FolderNode {
  const root: FolderNode = { name: "", files: [], folders: new Map() };
  for (const file of files) {
    const segments = file.path.split("/");
    const name = segments.pop() ?? file.path;
    let node = root;
    for (const segment of segments) {
      let child = node.folders.get(segment);
      if (child === undefined) {
        child = { name: segment, files: [], folders: new Map() };
        node.folders.set(segment, child);
      }
      node = child;
    }
    node.files.push(file);
  }
  return root;
}

function NewDiagramDialog({
  vaults,
  initialVaultId,
  defaultFolder,
  onClose,
  onCreate,
}: {
  vaults: VaultSummary[];
  initialVaultId: string;
  defaultFolder: string;
  onClose: () => void;
  onCreate: (vaultId: string, path: string) => Promise<void>;
}) {
  const [vaultId, setVaultId] = useState(initialVaultId);
  const [name, setName] = useState("Untitled diagram");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const folder = defaultFolder.replace(/^\/+|\/+$/g, "");
  const cleanName = name.trim().replace(/\.drawio$/i, "");
  const path = folder === "" ? `${cleanName}.drawio` : `${folder}/${cleanName}.drawio`;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New diagram</DialogTitle>
          <DialogDescription>
            Created as a <code>.drawio</code> file in the chosen vault's folder.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
            <span className="block text-xs text-muted-foreground">Saved to {path}</span>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Vault</span>
            <select
              value={vaultId}
              onChange={(event) => setVaultId(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              disabled={vaults.length === 0}
            >
              {vaults.map((vault) => (
                <option key={vault.id} value={vault.id}>
                  {vault.name}
                </option>
              ))}
            </select>
            {vaults.length === 0 ? (
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
            {pending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  path,
  onClose,
  onConfirm,
}: {
  path: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {fileName(path)}?</DialogTitle>
          <DialogDescription>
            The file is removed from the vault (with any kept draft). Agents and the
            Docs plugin see the same deletion. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
