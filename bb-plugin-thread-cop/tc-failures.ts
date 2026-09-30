// Pure failed-turn classification for Thread Cop v2. No I/O here: server.ts
// feeds this module from `turn.failed` plugin events and applies the outcome
// (threads.retry / metadata + log) itself.

export const TRANSIENT_CATEGORIES = [
  "stream-disconnected",
  "connection-failed",
  "overloaded",
  "internal",
  "rate-limit",
] as const;

export type TransientCategory = (typeof TRANSIENT_CATEGORIES)[number];

export type TurnFailureClass = "retry" | "escalate" | "stand-down";

export interface ProviderErrorInfoLike {
  category: string;
  httpStatusCode: number | null;
  providerCode: string | null;
}

export interface RateLimitStateLike {
  windows: Array<{ resetsAtMs: number | null; status?: string }>;
}

export interface RateLimitWindowLike {
  resetsAtMs: number | null;
  status?: string;
}

export interface TurnFailureFacts {
  /** Structured classification, or null when neither the provider nor a typed rejection carried one. */
  errorInfo: ProviderErrorInfoLike | null;
  /** Epoch ms windows with a non-null resetsAtMs mean core already queued the verbatim retry. */
  rateLimits: RateLimitStateLike | null;
  /** 1 is the original dispatch, 2 the first retry. */
  attemptNumber: number;
  /** Rows already queued for this thread as seen by the caller (0 = none). */
  queuedRetries: number;
}

/** attemptNumber must be below this for the plugin to queue another retry itself. */
export function maxPluginAttempts(maxFailedTurnRetries: number): number {
  return 1 + maxFailedTurnRetries;
}

/** Backoff ladder in ms for attempt-number `attempt` (1 = original dispatch failed). */
export function retryDelayMs(attempt: number, maxFailedTurnRetries: number): number {
  const ladderMs = [60_000, 5 * 60_000, 15 * 60_000];
  const index = Math.max(1, attempt) - 1;
  const cappedMax = Math.max(1, maxPluginAttempts(maxFailedTurnRetries) - 1);
  const clamped = Math.min(index, cappedMax);
  return ladderMs[Math.min(clamped, ladderMs.length - 1)];
}

function isTransient(errorInfo: ProviderErrorInfoLike | null): boolean {
  if (errorInfo === null) return false;
  if ((TRANSIENT_CATEGORIES as readonly string[]).includes(errorInfo.category)) {
    return true;
  }
  if (errorInfo.category !== "unknown") return false;
  const status = errorInfo.httpStatusCode;
  // Server-side reports (>= 500) and null-status network errors (provider
  // never got an HTTP answer) are the only unknowns worth re-trying.
  return status === null || status >= 500;
}

function rateLimitWindowResetting(state: RateLimitStateLike | null): boolean {
  if (state === null) return false;
  return state.windows.some((w) => w.resetsAtMs !== null);
}

/**
 * The failed-turn policy:
 * - stand-down when a windowed rate limit is in effect (core already queued
 *   the verbatim retry) — or OPTIONS already queued one — never re-queueing.
 * - retry transient failures (A1) while under the attempt cap.
 * - escalate everything else (A2): deterministic failures fail identically,
 *   so logging is the whole policy.
 */
export function classifyTurnFailure(
  facts: TurnFailureFacts,
  maxFailedTurnRetries: number = 2,
): TurnFailureClass {
  if (rateLimitWindowResetting(facts.rateLimits) || facts.queuedRetries > 0) {
    return "stand-down";
  }
  if (facts.attemptNumber < maxPluginAttempts(maxFailedTurnRetries)) {
    return isTransient(facts.errorInfo) ? "retry" : "escalate";
  }
  // At or past the cap, nothing is retried again.
  return "escalate";
}
