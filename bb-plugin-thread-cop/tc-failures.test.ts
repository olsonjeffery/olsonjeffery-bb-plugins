import { describe, expect, it } from "vitest";
import {
  classifyTurnFailure,
  maxPluginAttempts,
  retryDelayMs,
} from "./tc-failures.js";

const MAX_RETRIES = 2;

function facts(
  overrides: Partial<Parameters<typeof classifyTurnFailure>[0]> = {},
): Parameters<typeof classifyTurnFailure>[0] {
  return {
    errorInfo: null,
    rateLimits: null,
    attemptNumber: 1,
    queuedRetries: 0,
    ...overrides,
  };
}

describe("classifyTurnFailure — classification table", () => {
  it("retries every transient category (A1)", () => {
    for (const category of [
      "stream-disconnected",
      "connection-failed",
      "overloaded",
      "internal",
      "rate-limit",
    ]) {
      const c = classifyTurnFailure(
        facts({ errorInfo: { category, httpStatusCode: null, providerCode: null } }),
        MAX_RETRIES,
      );
      expect(c, category).toBe("retry");
    }
  });

  it("retries unknown failures with httpStatusCode >= 500 or a null status", () => {
    const base = { category: "unknown", providerCode: null };
    expect(classifyTurnFailure(facts({ errorInfo: { ...base, httpStatusCode: 502 } })), MAX_RETRIES).toBe("retry");
    expect(classifyTurnFailure(facts({ errorInfo: { ...base, httpStatusCode: null } }))).toBe("retry");
    expect(classifyTurnFailure(facts({ errorInfo: { ...base, httpStatusCode: 400 } }))).toBe("escalate");
    expect(classifyTurnFailure(facts({ errorInfo: { ...base, httpStatusCode: 429 } }))).toBe("escalate");
  });

  it("escalates (never retries) every permanent category (A2, F6)", () => {
    for (const category of [
      "bad-request",
      "unauthorized",
      "policy",
      "billing",
      "budget-exceeded",
      "context-window-exceeded",
      "max-turns",
      "structured-output-retries",
      "too-many-failed-attempts",
      "sandbox",
    ]) {
      const c = classifyTurnFailure(
        facts({ errorInfo: { category, httpStatusCode: null, providerCode: null } }),
        MAX_RETRIES,
      );
      expect(c, category).toBe("escalate");
    }
  });

  it("escalates a null errorInfo (no classification available)", () => {
    expect(classifyTurnFailure(facts({ errorInfo: null }))).toBe("escalate");
  });
});

describe("classifyTurnFailure — stand-down", () => {
  it("stands down when rateLimits carries a window with a resetsAtMs (core queued the retry)", () => {
    const c = classifyTurnFailure(
      facts({
        errorInfo: { category: "rate-limit", httpStatusCode: null, providerCode: null },
        rateLimits: { windows: [{ resetsAtMs: 1_700_000_000_000 + 60_000, status: "blocked" }] },
      }),
      MAX_RETRIES,
    );
    expect(c).toBe("stand-down");
  });

  it("does not stand down when windows exist but none resets in time", () => {
    const c = classifyTurnFailure(
      facts({
        errorInfo: { category: "rate-limit", httpStatusCode: null, providerCode: null },
        rateLimits: { windows: [{ resetsAtMs: null, status: "blocked" }] },
      }),
      MAX_RETRIES,
    );
    expect(c).toBe("retry");
  });

  it("stands down when a queued retry row already exists, whatever else the facts say", () => {
    const c = classifyTurnFailure(
      facts({
        errorInfo: { category: "stream-disconnected", httpStatusCode: null, providerCode: null },
        queuedRetries: 1,
      }),
      MAX_RETRIES,
    );
    expect(c).toBe("stand-down");
  });
});

describe("classifyTurnFailure — attempt cap", () => {
  it("caps self-retries at maxFailedTurnRetries (attempt 1..2 retry, 3 escalates)", () => {
    const transient = { category: "stream-disconnected", httpStatusCode: null, providerCode: null };
    expect(classifyTurnFailure(facts({ errorInfo: transient, attemptNumber: 1 }))).toBe("retry");
    expect(classifyTurnFailure(facts({ errorInfo: transient, attemptNumber: 2 }))).toBe("retry");
    expect(classifyTurnFailure(facts({ errorInfo: transient, attemptNumber: 3 }))).toBe("escalate");
    expect(maxPluginAttempts(MAX_RETRIES)).toBe(3);
  });

  it("respects a zero-retry configuration: the first failure escalates", () => {
    const transient = { category: "stream-disconnected", httpStatusCode: null, providerCode: null };
    expect(classifyTurnFailure(facts({ errorInfo: transient }), 0)).toBe("escalate");
    expect(classifyTurnFailure(facts({ errorInfo: transient, attemptNumber: 2 }), 0)).toBe("escalate");
  });
});

describe("retryDelayMs", () => {
  it("follows the 1m / 5m / 15m backoff ladder and clamps past the cap", () => {
    expect(retryDelayMs(1, MAX_RETRIES)).toBe(60_000);
    expect(retryDelayMs(2, MAX_RETRIES)).toBe(5 * 60_000);
    expect(retryDelayMs(3, MAX_RETRIES)).toBe(15 * 60_000);
    expect(retryDelayMs(9, MAX_RETRIES)).toBe(15 * 60_000);
    expect(retryDelayMs(0, 0)).toBe(60_000);
  });
});
