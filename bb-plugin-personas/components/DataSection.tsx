// The Export & import card on the Personas settings page (app.slots.
// settingsSection). Export calls exportPersonas and hands the array — one
// object per persona — to the browser as personas.json; import reads a file
// back, hands it to importPersonas, and reports the batch outcome: imported
// count, how many were skipped, and the reason for each skip. Both are
// additive, collision-safe operations, so no confirmation step: the summary
// line after the action IS the report.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { usePersonasRpc } from "@/components/use-query";
import { Icon } from "@/components/ui/icon";

interface ImportReport {
  imported: number;
  skipped: number;
  errors: { index: number; error: string }[];
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function downloadExport(json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "personas.json";
  link.click();
  URL.revokeObjectURL(url);
}

export function DataSection() {
  const rpc = usePersonasRpc();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function onExport() {
    setIsBusy(true);
    try {
      const { personas } = await rpc.call("exportPersonas", null);
      downloadExport(JSON.stringify(personas, null, 2));
      toast.success(`Exported ${personas.length} persona${personas.length === 1 ? "" : "s"}`);
    } catch (cause) {
      toast.error(describeError(cause));
    } finally {
      setIsBusy(false);
    }
  }

  async function onImportFile(file: File) {
    setIsBusy(true);
    setReport(null);
    setFailure(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error(`${file.name} is not valid JSON`);
      }
      if (!Array.isArray(parsed)) {
        throw new Error("Expected a JSON array of personas at the top level");
      }
      const result = await rpc.call("importPersonas", { personas: parsed });
      setReport(result);
      if (result.imported === 0) {
        toast.error("Nothing imported");
      } else {
        toast.success(`Imported ${result.imported} persona${result.imported === 1 ? "" : "s"}`);
      }
    } catch (cause) {
      setFailure(describeError(cause));
      toast.error(describeError(cause));
    } finally {
      setIsBusy(false);
      // A re-pick of the SAME file must still fire onChange.
      if (fileInputRef.current !== null) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border bg-card px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <Icon name="HardDriveDownload" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Personas data</p>
            <p className="truncate text-xs text-muted-foreground">
              All personas with their prompts, emoji, and colors — note prompts copy their note's current body.
            </p>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void onExport()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Icon name="Download" aria-hidden className="size-3.5" />
            Export
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Icon name="Upload" aria-hidden className="size-3.5" />
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void onImportFile(file);
            }}
          />
        </div>
        {failure === null && report === null ? null : (
          <div className="mt-2.5 border-t border-border pt-2.5 text-xs">
            {failure !== null ? (
              <p className="truncate text-destructive">Couldn't import: {failure}</p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  Imported {report!.imported}
                  {report!.skipped > 0 ? ` · skipped ${report!.skipped}` : ""}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {report!.errors.map((entry) => (
                    <li key={entry.index} className="truncate text-destructive">
                      #{entry.index + 1}: {entry.error}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
