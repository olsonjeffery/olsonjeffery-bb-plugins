import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { promptPreview } from "@/personas";
import { usePersonasRpc, useQuery } from "@/components/use-query";

/** One selectable row in a prompt-source picker. */
interface PickerItem {
  id: string;
  label: string;
  secondary: string | null;
}

interface SourcePickerDialogProps {
  title: string;
  description: string;
  searchLabel: string;
  searchPlaceholder: string;
  items: PickerItem[];
  isLoading: boolean;
  error: string | null;
  /** Optional control row between the description and the search field. */
  toolbar?: ReactNode;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/**
 * The shared single-select picker modal behind "Add Floating Note": a search
 * field filtering the list inline, one click to pick.
 * Mounted only while open, so the source list loads lazily per open.
 */
function SourcePickerDialog({
  title,
  description,
  searchLabel,
  searchPlaceholder,
  items,
  isLoading,
  error,
  toolbar,
  onSelect,
  onClose,
}: SourcePickerDialogProps) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const filtered =
    needle === ""
      ? items
      : items.filter((item) =>
          `${item.label}\n${item.secondary ?? ""}`.toLowerCase().includes(needle),
        );

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {toolbar}
        <Input
          aria-label={searchLabel}
          value={search}
          placeholder={searchPlaceholder}
          onChange={(event) => setSearch(event.target.value)}
        />
        {error !== null ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to pick yet.</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {filtered.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="w-full truncate text-sm font-medium">
                    {item.label}
                  </span>
                  {item.secondary === null ? null : (
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {item.secondary}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One attachable Floating Note, as the personas RPC returns it. */
export interface AttachableNote {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
}

/** One attachable Docs document, as the personas RPC returns it. */
export interface AttachableDoc {
  vaultId: string;
  path: string;
  title: string;
  preview: string;
}

export function FloatingNotePickerDialog({
  onSelectNote,
  onClose,
}: {
  onSelectNote: (note: AttachableNote) => void;
  onClose: () => void;
}) {
  const rpc = usePersonasRpc();
  const { data, error, isLoading } = useQuery(
    () => rpc.call("listFloatingNotes", null),
    "floating-notes-picker",
  );
  const notes = data?.notes ?? [];

  return (
    <SourcePickerDialog
      title="Add Floating Note"
      description="Pick one note to add to this persona's prompt pool."
      searchLabel="Search notes"
      searchPlaceholder="Search notes…"
      items={notes.map((note) => ({
        id: note.id,
        label: note.title,
        secondary: promptPreview(note.body),
      }))}
      isLoading={isLoading}
      error={error}
      onSelect={(id) => {
        const note = notes.find((candidate) => candidate.id === id);
        if (note !== undefined) onSelectNote(note);
      }}
      onClose={onClose}
    />
  );
}

/** One Docs vault with its markdown documents, as the personas RPC returns it. */
interface DocsSourceVault {
  id: string;
  name: string;
  notes: { path: string; title: string; preview: string; modifiedAtMs: number }[];
}

/**
 * The picker modal behind "Add Docs document": a vault selector over a
 * search field filtering the selected vault's documents inline, one click to
 * pick. Mounted only while open, so the source list loads lazily per open.
 * The vault choice lives in the dialog — switching vaults re-filters in
 * place, no extra round trip.
 */
export function DocsPickerDialog({
  onSelectDoc,
  onClose,
}: {
  onSelectDoc: (doc: AttachableDoc) => void;
  onClose: () => void;
}) {
  const rpc = usePersonasRpc();
  const { data, error, isLoading } = useQuery(
    () => rpc.call("listDocsSources", null),
    "docs-sources-picker",
  );
  const vaults = data?.vaults ?? [];
  const [vaultId, setVaultId] = useState<string | null>(null);
  // The first vault is the default selection (the docs plugin's own
  // first-created vault); an empty vault list keeps the selector quiet.
  const selectedVaultId = vaultId ?? vaults[0]?.id ?? null;
  const selectedVault =
    vaults.find((vault) => vault.id === selectedVaultId) ?? null;
  const notes = selectedVault?.notes ?? [];

  return (
    <SourcePickerDialog
      title="Add Docs document"
      description="Pick one vault document to add to this persona's prompt pool."
      searchLabel="Search documents"
      searchPlaceholder="Search documents…"
      items={notes.map((note) => ({
        // The vault id + path pair identifies the document; the title (or the
        // bare path when untitled) is what the row and the search filter on.
        id: `${note.path}`,
        label: note.title.trim().length > 0 ? note.title : note.path,
        secondary: promptPreview(note.preview),
      }))}
      isLoading={isLoading}
      error={error}
      toolbar={
        vaults.length > 1 ? (
          <Select value={selectedVaultId ?? ""} onValueChange={setVaultId}>
            <SelectTrigger aria-label="Vault">
              <SelectValue placeholder="Vault" />
            </SelectTrigger>
            <SelectContent>
              {vaults.map((vault) => (
                <SelectItem key={vault.id} value={vault.id}>
                  {vault.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null
      }
      onSelect={(path) => {
        const note = notes.find((candidate) => candidate.path === path);
        if (note !== undefined && selectedVaultId !== null) {
          onSelectDoc({
            vaultId: selectedVaultId,
            path: note.path,
            title: note.title,
            preview: note.preview,
          });
        }
      }}
      onClose={onClose}
    />
  );
}
