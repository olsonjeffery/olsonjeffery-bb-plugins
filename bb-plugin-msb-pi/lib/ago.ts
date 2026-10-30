// bb-plugin-msb-pi — relative time, shared by the page and the CLI.

/** "just now", "42s ago", "7m ago", "3h 12m ago", "5d ago", then date. */
export function formatAgo(ms: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - ms);
  if (delta < 45_000) return "just now";
  const seconds = Math.round(delta / 1000);
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest >= 5 && hours < 10 ? `${hours}h ${rest}m ago` : `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}
