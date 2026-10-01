import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
