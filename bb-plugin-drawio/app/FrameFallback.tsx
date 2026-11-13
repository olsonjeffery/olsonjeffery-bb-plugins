// bb-plugin-drawio — frame chrome shared by the embed editor and the
// read-only viewer: the mixed-content banner and the connecting/error body.
import { Icon } from "@/components/ui/icon";
import { isMixedContent } from "./drawio.js";
import { cn } from "@/lib/utils";

/**
 * https app page + http instance = the browser blocks the frame's script and
 * shows nothing. Say why instead of a blank frame.
 */
export function MixedContentBanner({ instanceUrl }: { instanceUrl: string }) {
  if (!isMixedContent(instanceUrl)) return null;
  return (
    <div className="flex items-start gap-2 border-b border-border bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
      <Icon name="AlertTriangle" className="mt-0.5 size-3.5 shrink-0" />
      <span>
        This page is served over HTTPS but the draw.io instance is HTTP, so the browser blocks
        the embedded editor. Serve the instance over HTTPS.
      </span>
    </div>
  );
}

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
