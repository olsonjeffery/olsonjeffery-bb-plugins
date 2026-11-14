import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** "3 threads" / "1 thread" — the one plural the pill titles and the group
 *  captions share. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The container's attention pills — ONE grammar shared by every container
 * caption (section group header, spool card): "N failed" on the destructive
 * surface, "N needs you" on the attention surface with its pulsing amber
 * dot (gated by the list's motion setting and prefers-reduced-motion like
 * every dot), and a plain success working count with a spinner. Each pill
 * renders only while its count is above zero; the whole lane renders
 * nothing when none do.
 *
 * Containers render this lane only while FOLDED: an expanded container's
 * own rows already carry the attention (row pills, status glyphs), so the
 * caption would say every state twice — the innermost visible level owns
 * it. Callers that already dedicate a slot to running work (the spool
 * card's meta line + pip spinner) pass live={0} instead of restyling the
 * same count twice.
 */
export function AttentionPills(props: {
  failed: number;
  needsUser: number;
  live: number;
  className?: string;
}) {
  if (props.failed === 0 && props.needsUser === 0 && props.live === 0) {
    return null;
  }
  return (
    <span className={cn("spooler-group-pills", props.className)}>
      {props.failed > 0 ? (
        <span
          className="spooler-group-pill spooler-group-pill-failed"
          title={plural(props.failed, "failed thread")}
        >
          <span className="spooler-dot spooler-dot-error" aria-hidden="true" />
          {props.failed} failed
        </span>
      ) : null}
      {props.needsUser > 0 ? (
        <span
          className="spooler-group-pill spooler-group-pill-needs"
          title={plural(props.needsUser, "thread waiting for input")}
        >
          <span
            className="spooler-dot spooler-dot-attention spooler-dot-pulse"
            aria-hidden="true"
          />
          {props.needsUser} needs you
        </span>
      ) : null}
      {props.live > 0 ? (
        <span
          className="spooler-group-pill spooler-group-pill-working"
          title={plural(props.live, "running thread")}
        >
          <span className="spooler-spinner spooler-tone-success spooler-group-pill-spinner">
            <Icon name="Loading" aria-hidden="true" />
          </span>
          {props.live} working
        </span>
      ) : null}
    </span>
  );
}
