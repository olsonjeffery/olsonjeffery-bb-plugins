// Pure runaway-loop detection for Thread Cop v2 (F5). No I/O here: server.ts
// feeds signatures from the thread event log and delivers the steer itself.

export interface LoopObservation {
  signature: string;
  at: number;
}

/**
 * Normalize a commandExecution's command text: collapse all runs of
 * whitespace (including newlines) into single spaces and trim, so a
 * re-run formatted with a different indent still matches.
 */
export function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

/**
 * A signature for one observed call. toolCall → the tool name plus a
 * compact input summary when one is available; commandExecution → the
 * normalized command text.
 */
export function signatureOf(observation: {
  kind: "tool" | "command";
  name: string;
  input?: unknown;
  command?: string;
}): string {
  if (observation.kind === "command") {
    return `command:${normalizeCommand(observation.command ?? "")}`;
  }
  const input = observation.input;
  let summary = "";
  if (typeof input === "string") {
    summary = input.slice(0, 200);
  } else if (input !== undefined && input !== null) {
    try {
      summary = JSON.stringify(input).slice(0, 200);
    } catch {
      summary = "";
    }
  }
  return `tool:${observation.name}${summary.length > 0 ? `(${summary})` : ""}`;
}

/** Push an observation and trim the buffer to observations still inside the window. */
export function observeLoop(
  buffer: LoopObservation[],
  signature: string,
  at: number,
  windowMs: number,
): void {
  buffer.push({ signature, at });
  const oldest = at - windowMs;
  let firstKept = 0;
  while (firstKept < buffer.length && buffer[firstKept].at <= oldest) firstKept++;
  buffer.splice(0, firstKept);
}

export interface LoopVerdict {
  /** True when this observation trips the alert (once per loop run). */
  tripped: boolean;
  /** Total observations of this signature inside the window, including the new one. */
  count: number;
}

/**
 * Evaluate whether this observation should steer the agent. Trips when
 * `repeatCount` identical signatures landed within the last `windowMs` and
 * the run has not been alerted already — the caller expresses the re-arm rule
 * ("only after a distinct signature interleaves") by clearing the buffer when
 * it alerts, storing the run's `lastSignature, and dropping only that
 * signature's entries the next time a distinct one arrives.
 */
export function loopVerdict(
  buffer: LoopObservation[],
  signature: string,
  now: number,
  windowMs: number,
  repeatCount: number,
): LoopVerdict {
  let count = 0;
  for (const observation of buffer) {
    if (observation.signature === signature && observation.at > now - windowMs) {
      count += 1;
    }
  }
  return { tripped: count >= Math.max(1, repeatCount), count };
}

/**
 * Update the caller's armed state when a signature is observed: the signature
 * that most recently tripped an alert keeps the detector quiet, and any
 * distinct signature re-arms it.
 */
export function noteObservedSignature(
  lastAlertedSignature: string | null,
  signature: string,
): string | null {
  return lastAlertedSignature === signature ? lastAlertedSignature : null;
}

/**
 * After alerting on a loop run: drop every observation of that signature from
 * the buffer (further identical observations re-count from zero) and return
 * the signature the caller should store as `lastAlertedSignature`.
 */
export function markAlerted(buffer: LoopObservation[], signature: string): string | null {
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (buffer[i].signature === signature) buffer.splice(i, 1);
  }
  return signature;
}

/**
 * Whether the detector is armed for `signature`: not the signature that most
 * recently tripped an alert.
 */
export function loopIsArmed(lastAlertedSignature: string | null, signature: string): boolean {
  return lastAlertedSignature === null || lastAlertedSignature !== signature;
}
