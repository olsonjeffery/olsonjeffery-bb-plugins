// bb-plugin-drawio — the diagram browser.
//
// The vault picker + folder tree + .drawio list, shared by the left sidebar
// (experimental_sidebar) and the panel's fixed right-panel tab. Clicking a
// diagram opens it through the callback the surface provides; the panel tab
// additionally offers "open in tab" (its own panel controller).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRealtime, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract.js";
import { STARTER_XML } from "../contract.js";
import type { DocRef, VaultFileEntry, VaultSummary } from "../contract.js";
import { docTitle } from "./drawio.js";
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

export interface DiagramsBrowserProps {
  variant: "sidebar" | "panel";
  /** What opening a doc means on this surface. */
  onOpenRef: (ref: DocRef) => void;
  /** Only the panel tab has a controller that can open action tabs. */
  onOpenTab?: (ref: DocRef) => void;
}

interface FolderNode {
  name: string;
  files: VaultFileEntry[];
  folders: Map<string, FolderNode>;
}

export function DiagramsBrowser({ variant, onOpenRef, onOpenTab }: DiagramsBrowserProps) {
  const rpc = useRpc<typeof rpcContract>();
  const values = useSettings().values ?? {};
  const [vaults, setVaults] = useState<VaultSummary[] | null>(null);
  const [vaultId, setVaultId] = useState<string>("");
  const [files, setFiles] = useState<VaultFileEntry[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const configured = typeof values.instanceUrl === "string" && values.instanceUrl.trim() !== "";
  const preferredVault = typeof values.defaultVaultId === "string" ? values.defaultVaultId : "";

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

  // First-level folders start expanded so the diagram list is one glance away;
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
          aria-label="Refresh diagram list"
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
          <p className="px-1 py-2 text-xs text-muted-foreground">Loading diagrams…</p>
        ) : null}
        {files !== null && files.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            No .drawio files in this vault yet. Create one above.
          </p>
        ) : null}
        {[...tree.folders.values()].map((node) => (
          <FolderRow
            key={node.name}
            node={node}
            depth={0}
            prefix=""
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
            onOpen={(path) => onOpenRef({ kind: "vault", vaultId, path })}
            onOpenTab={
              onOpenTab === undefined ? undefined : (path) => onOpenTab({ kind: "vault", vaultId, path })
            }
          />
        ))}
      </div>

      {newOpen ? (
        <NewDiagramDialog
          vaults={vaults ?? []}
          initialVaultId={vaultId}
          defaultFolder={typeof values.defaultFolder === "string" ? values.defaultFolder : "diagrams"}
          onClose={() => setNewOpen(false)}
          onCreate={async (targetVaultId, path) => {
            await rpc.call("vault.create", { vaultId: targetVaultId, path, content: STARTER_XML });
            setNewOpen(false);
            loadFiles(false);
            onOpenRef({ kind: "vault", vaultId: targetVaultId, path });
          }}
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
        <code>jgraph/drawio</code> Docker image works as-is.
      </p>
    </div>
  );
}

interface RowActions {
  onOpen: (path: string) => void;
  onOpenTab?: (path: string) => void;
}

function FolderRow({
  node,
  depth,
  prefix,
  expanded,
  toggle,
  onOpen,
  onOpenTab,
}: {
  node: FolderNode;
  depth: number;
  prefix: string;
  expanded: Set<string>;
  toggle: (path: string) => void;
  onOpen: RowActions["onOpen"];
  onOpenTab?: RowActions["onOpenTab"];
}) {
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
              expanded={expanded}
              toggle={toggle}
              onOpen={onOpen}
              onOpenTab={onOpenTab}
            />
          ))}
          {node.files.map((file) => (
            <FileRow
              key={file.path}
              path={file.path}
              depth={depth + 1}
              onOpen={onOpen}
              onOpenTab={onOpenTab}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FileRow({ path, depth, onOpen, onOpenTab }: { path: string; depth: number } & RowActions) {
  return (
    <div className="group/row flex items-center gap-0.5 rounded-md pr-1 hover:bg-accent" style={{ paddingLeft: `${depth * 12 + 4}px` }}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-xs"
        onClick={() => onOpen(path)}
        title={path}
      >
        <Icon name="Workflow" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{docTitleFromPath(path)}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
            aria-label={`Actions for ${docTitleFromPath(path)}`}
          >
            <Icon name="MoreHorizontal" className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => onOpen(path)}>Open</DropdownMenuItem>
          {onOpenTab !== undefined ? (
            <DropdownMenuItem onSelect={() => onOpenTab(path)}>Open in tab</DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function docTitleFromPath(path: string): string {
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
