import { Icon } from "@/components/ui/icon";

/**
 * The "this chat is working" glyph, shared by the chat list and the rail:
 * BB's own Spinner icon in the plugin's green (the same emerald-600 /
 * dark:emerald-400 pair the Floating Notes "installed and enabled" check
 * wears), sized to sit where a small text label would.
 */
export function RunningSpinner({ size = "sm" }: { size?: "sm" | "xs" }) {
  return (
    <span
      aria-label="Running"
      className={`shrink-0 text-emerald-600 dark:text-emerald-400 ${size === "xs" ? "text-[10px]" : ""}`}
    >
      <Icon
        name="Spinner"
        className={size === "xs" ? "size-3 animate-spin" : "size-3.5 animate-spin"}
        aria-hidden
      />
    </span>
  );
}
