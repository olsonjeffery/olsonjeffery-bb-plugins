import { describe, expect, it } from "vitest";

describe("groupGlyph", () => {
  it("gives every grouping mode a distinct, correct icon", async () => {
    const { groupGlyph } = await import("./SpoolerGroupHeader");
    // Regression: the sortable path rendered a folder for the Pinned group,
    // and time/section groups rendered no icon at all.
    expect(groupGlyph({ id: "pinned", icon: "Pin", projectId: null }, true)).toBe(
      "Pin",
    );
    expect(
      groupGlyph({ id: "section:s1", icon: "Hash", projectId: null }, false),
    ).toBe("Hash");
  });
});
