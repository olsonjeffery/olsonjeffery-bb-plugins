// bb-plugin-drawio — frame chrome shared by the embed editor and the
// read-only viewer: the connecting/error body.
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export function FrameFallback({
  loading,
  detail,
  onRetry,
}: {
  loading?: boolean;
  detail: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
      {loading ? (
        <>
          <Icon name="Loading" className="size-5 animate-spin" />
          <p>Connecting to the draw.io instance…</p>
        </>
      ) : (
        <>
          <Icon name="AlertCircle" className="size-5 text-destructive" />
          <p className={cn("max-w-md")}>{detail ?? "The editor did not load."}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              Retry
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
