import { describe, expect, it } from "vitest";
import {
  draftIsEmpty,
  newDraftStackId,
  relativeSavedAt,
  sanitizeEntry,
  sanitizeStack,
} from "./draft-stack.js";

const NOW = 1_700_000_000_000;

describe("draftIsEmpty", () => {
  it("is true with only whitespace, no mentions, no attachments", () => {
    expect(draftIsEmpty({ text: "  \n\t", mentions: [], attachments: [] })).toBe(true);
  });
  it("is false with text", () => {
    expect(draftIsEmpty({ text: "hi", mentions: [], attachments: [] })).toBe(false);
  });
  it("is false with an attachment despite no text", () => {
    expect(
      draftIsEmpty({
        text: "",
        mentions: [],
        attachments: [{ type: "localImage", name: "a", path: "p/1", sizeBytes: 1 }],
      }),
    ).toBe(false);
  });
});

describe("sanitizeEntry", () => {
  it("keeps a valid entry", () => {
    const entry = sanitizeEntry(
      {
        id: "dsk_x",
        text: "hello 'quotes' \"double\" ⚡ \\<script\\>",
        attachments: [{ type: "localImage", name: "pic", path: "proj/att/pic", sizeBytes: 12, mimeType: "image/png" }],
        projectId: "proj_1",
        threadId: null,
        createdAt: 123,
      },
      NOW,
    );
    expect(entry?.id).toBe("dsk_x");
    expect(entry?.text).toContain("<script");
    expect(entry?.attachments).toHaveLength(1);
    expect(entry?.projectId).toBe("proj_1");
  });
  it("preserves unknown extra fields (arbitrary rewrite)", () => {
    const entry = sanitizeEntry({ text: "x", flavor: "spicy", stars: [1, 2] }, NOW);
    expect(entry).toMatchObject({ text: "x", flavor: "spicy", stars: [1, 2] });
    expect(entry?.id).toMatch(/^dsk_/);
  });
  it("returns null for non-objects", () => {
    expect(sanitizeEntry("nope", NOW)).toBeNull();
    expect(sanitizeEntry(null, NOW)).toBeNull();
    expect(sanitizeEntry(42, NOW)).toBeNull();
  });
  it("drops malformed attachments and mentions", () => {
    const entry = sanitizeEntry(
      {
        text: "x",
        attachments: [null, { type: "remote", path: "x" }, { type: "localFile", name: "ok", path: "a/b" }],
        mentions: [{ kind: "nonsense" }, "handwritten", { kind: "path", from: 5, to: 2, label: "x" }],
      },
      NOW,
    );
    expect(entry?.attachments).toEqual([{ type: "localFile", name: "ok", path: "a/b", sizeBytes: 0 }]);
    expect(entry?.mentions).toHaveLength(0);
  });
});

describe("sanitizeStack", () => {
  it("drops nulls and re-ids duplicates", () => {
    const stack = sanitizeStack(
      [{ id: "a", text: "one" }, null, { id: "a", text: "two" }],
      NOW,
    );
    expect(stack).toHaveLength(2);
    expect(stack[0].id).toBe("a");
    expect(stack[1].id).not.toBe("a");
    expect(stack[1].text).toBe("two");
  });
  it("keeps the TOP when over the cap (drops oldest from the bottom)", () => {
    const many = Array.from({ length: 105 }, (_, i) => ({ id: `e${i}`, text: `t${i}` }));
    const stack = sanitizeStack(many, NOW);
    expect(stack).toHaveLength(100);
    expect(stack[0].id).toBe("e5");
    expect(stack.at(-1)?.id).toBe("e104");
  });
});

describe("newDraftStackId", () => {
  it("mints distinct ids", () => {
    const a = newDraftStackId(NOW);
    const b = newDraftStackId(NOW);
    expect(a).not.toBe(b);
    expect(a.startsWith("dsk_")).toBe(true);
  });
});

describe("relativeSavedAt", () => {
  it("formats seconds/minutes/hours/days", () => {
    expect(relativeSavedAt(NOW - 5_000, NOW)).toMatch(/5s|sec/);
    expect(relativeSavedAt(NOW - 3 * 60_000, NOW)).toMatch(/3m|min/);
    expect(relativeSavedAt(NOW - 2 * 3_600_000, NOW)).toMatch(/2h|hr/);
    expect(relativeSavedAt(NOW - 5 * 86_400_000, NOW)).toMatch(/5d|day/);
  });
});
