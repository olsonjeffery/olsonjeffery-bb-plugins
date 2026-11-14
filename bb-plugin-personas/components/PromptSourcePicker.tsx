import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { docPromptRefKey, promptPreview } from "@/personas";
import { usePersonasRpc, useQuery } from "@/components/use-query";

/** One selectable row in a prompt-source picker. */
interface PickerItem {
  id: string;
  label: string;
  secondary: string | null;
}

/** How the dialog behaves when the caller wants several rows committed together. */
interface MultiSelect {
  /** The selected rows, by item id. Owned by the caller — the dialog toggles. */
  checkedIds: ReadonlySet<string>;
  /** One row click: check or uncheck that item. */
  onToggle: (id: string) => void;
  /** The commit button's label, count already interpolated ("Add 2 documents"). */
  confirmLabel: string;
  /** Committing the selection; the caller closes the dialog from here. */
  onCommit: () => void;
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
  /** Single-select mode: one click picks and closes. Absent in multi mode. */
  onSelect?: (id: string) => void;
  /** Multi-select mode: rows toggle, a confirm bar commits them together. */
  multiSelect?: MultiSelect;
  onClose: () => void;
}

/**
 * The shared picker modal behind the prompt sources: a search field filtering
 * the list inline. Single-select mode ("Add Floating Note") picks and closes
 * on one click; multi-select mode ("Add Docs document") toggles checked rows
 * and commits them all through the confirm bar.
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
  multiSelect,
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
          <>
            <ul
              {...(multiSelect
                ? { role: "listbox", "aria-multiselectable": true }
                : {})}
              className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border"
            >
              {filtered.map((item) => {
                const checked = multiSelect?.checkedIds.has(item.id) ?? false;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      {...(multiSelect
                        ? { role: "option", "aria-selected": checked }
                        : {})}
                      onClick={() =>
                        multiSelect
                          ? multiSelect.onToggle(item.id)
                          : onSelect?.(item.id)
                      }
                      className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      {multiSelect ? (
                        // The checkbox is decorative; aria-selected on the
                        // option is the state a screen reader hears.
                        <span
                          aria-hidden
                          className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input"
                          }`}
                        >
                          {checked ? (
                            <Icon name="Check" className="size-3" />
                          ) : null}
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block w-full truncate text-sm font-medium">
                          {item.label}
                        </span>
                        {item.secondary === null ? null : (
                          <span className="block w-full truncate text-xs text-muted-foreground">
                            {item.secondary}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {multiSelect ? (
              <div className="flex items-center justify-between gap-2 pt-1">
                <span aria-live="polite" className="text-xs text-muted-foreground">
                  {multiSelect.checkedIds.size} selected
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={multiSelect.checkedIds.size === 0}
                  onClick={multiSelect.onCommit}
                >
                  {multiSelect.confirmLabel}
                </Button>
              </div>
            ) : null}
          </>
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
 * search field filtering the selected vault's documents inline, multi-select
 * — rows toggle, and a confirm bar attaches every checked document at once.
 * Mounted only while open, so the source list loads lazily per open. The
 * vault choice lives in the dialog — switching vaults re-filters in place,
 * no extra round trip, and the selection survives the switch (and the
 * search filter), so documents from several vaults can ride one commit.
 */
export function DocsPickerDialog({
  onSelectDocs,
  onClose,
}: {
  onSelectDocs: (docs: AttachableDoc[]) => void;
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
  // The checked set, keyed by the same vault+path pair the pool stores —
  // identical paths in two vaults are different documents. Selection state
  // outlives vault switches and search narrowing within the open dialog.
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());

  // Every attachable document across ALL vaults, by its checked-set key, so
  // the commit can resolve the whole selection even when most of it is in
  // vaults the list isn't showing right now.
  const docsByKey = new Map<string, AttachableDoc>();
  for (const vault of vaults) {
    for (const note of vault.notes) {
      docsByKey.set(docPromptRefKey(vault.id, note.path), {
        vaultId: vault.id,
        path: note.path,
        title: note.title,
        preview: note.preview,
      });
    }
  }

  function toggle(key: string): void {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // List order, most recently checked first: the pool entries land in the
  // order the user picked them.
  const selectedDocs = [...checked]
    .map((key) => docsByKey.get(key))
    .filter((doc) => doc !== undefined);

  return (
    <SourcePickerDialog
      title="Add Docs document"
      description="Pick one or more vault documents to add to this persona's prompt pool."
      searchLabel="Search documents"
      searchPlaceholder="Search documents…"
      items={notes.map((note) => ({
        // The vault id + path pair identifies the document; the title (or the
        // bare path when untitled) is what the row and the search filter on.
        id: selectedVaultId === null ? note.path : docPromptRefKey(selectedVaultId, note.path),
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
      multiSelect={{
        checkedIds: checked,
        onToggle: toggle,
        confirmLabel: `Add ${selectedDocs.length} document${
          selectedDocs.length === 1 ? "" : "s"
        }`,
        onCommit: () => onSelectDocs(selectedDocs),
      }}
      onClose={onClose}
    />
  );
}
