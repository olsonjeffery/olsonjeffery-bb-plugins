/** A dead-simple bus for "open this row's Details" intents.
 *
 * The inline Details state lives in the row (it must: opening it re-renders
 * one row, not the list), but the thread context menu lives in the list.
 * Touch users reach Details through the More menu — there is no hover
 * cluster — so the menu publishes an intent here and the owning row reacts.
 * Mirrors paletteBus; same trade-offs: no cancellation, no dedupe.
 */
export type openDetailsIntent = { threadId: string };

let pending: openDetailsIntent | null = null;
const listeners = new Set<(intent: openDetailsIntent) => void>();

export function openThreadDetails(threadId: string): void {
  const intent = { threadId };
  pending = intent;
  for (const listener of listeners) listener(intent);
  pending = null;
}

export function onOpenThreadDetails(
  listener: (intent: openDetailsIntent) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function drainOpenThreadDetails(): openDetailsIntent | null {
  const drained = pending;
  pending = null;
  return drained;
}
