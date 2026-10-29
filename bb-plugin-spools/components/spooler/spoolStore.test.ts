import { describe, expect, it } from "vitest";
import {
  deriveSpools,
  familyOf,
  newSpoolId,
  planAddReconcile,
  planLeadMigration,
  planMetadataWrites,
  releasePatch,
  spoolTitleFor,
  type SpoolMetadataWrite,
} from "./spoolStore";

/* Threads only need the title fields for derivation. */
const thread = (id: string, title?: string) => ({
  id,
  displayTitle: title ?? id,
  title: title ?? id,
});

describe("deriveSpools", () => {
  it("builds a spool from per-thread metadata rows", () => {
    const { spools } = deriveSpools({
      threads: [thread("t1", "Alpha"), thread("t2", "Beta"), thread("t3")],
      metadataByThreadId: new Map([
        ["t1", { spool: "spool_a", spoolJoined: 10, spoolLead: true }],
        ["t2", { spool: "spool_a", spoolJoined: 20 }],
      ]),
    });
    expect(spools).toHaveLength(1);
    const spool = spools[0];
    expect(spool.id).toBe("spool_a");
    expect(spool.members).toEqual(["t1", "t2"]);
    expect(spool.leadThreadId).toBe("t1");
    expect(spool.customTitle).toBeNull();
    expect(spool.title).toBe("Spool: Alpha");
  });

  it("orders members by join time, ties by id", () => {
    const { spools } = deriveSpools({
      threads: [thread("t2"), thread("t1"), thread("t3")],
      metadataByThreadId: new Map([
        ["t3", { spool: "spool_a", spoolJoined: 5 }],
        ["t1", { spool: "spool_a", spoolJoined: 20 }],
        ["t2", { spool: "spool_a", spoolJoined: 5 }],
      ]),
    });
    expect(spools[0].members).toEqual(["t2", "t3", "t1"]);
  });

  /* "Add to top of spool" writes a negative join stamp (see ./addPosition]:
     it must out-sort every positive-stamp member, and successive top adds
     (ever more negative) must land above earlier ones. */
  it("sorts negative top-add stamps above positive members, newest first", () => {
    const { spools } = deriveSpools({
      threads: [thread("t1"), thread("t2"), thread("t3"), thread("t4")],
      metadataByThreadId: new Map([
        ["t1", { spool: "spool_a", spoolJoined: 10 }],
        ["t2", { spool: "spool_a", spoolJoined: -2_000 }],
        ["t3", { spool: "spool_a", spoolJoined: -3_000 }],
        ["t4", { spool: "spool_a", spoolJoined: 20 }],
      ]),
    });
    expect(spools[0].members).toEqual(["t3", "t2", "t1", "t4"]);
  });

  it("elects the oldest member when the lead disappears", () => {
    const { spools } = deriveSpools({
      threads: [thread("t2", "Second"), thread("t3")],
      metadataByThreadId: new Map([
        ["t2", { spool: "spool_a", spoolJoined: 10 }],
        ["t3", { spool: "spool_a", spoolJoined: 20 }],
      ]),
    });
    expect(spools[0].leadThreadId).toBe("t2");
    expect(spools[0].title).toBe("Spool: Second");
  });

  it("honours a custom title stored on the lead", () => {
    const { spools } = deriveSpools({
      threads: [thread("t1", "Alpha"), thread("t2")],
      metadataByThreadId: new Map([
        ["t1", { spool: "spool_a", spoolJoined: 10, spoolLead: true, spoolTitle: "Fuzz sprint" }],
        ["t2", { spool: "spool_a", spoolJoined: 20 }],
      ]),
    });
    expect(spools[0].title).toBe("Fuzz sprint");
    expect(spools[0].customTitle).toBe("Fuzz sprint");
  });

  it("drops spools when every member is gone", () => {
    const { spools, membershipByThreadId } = deriveSpools({
      threads: [thread("t3")],
      metadataByThreadId: new Map([
        ["t1", { spool: "spool_a", spoolJoined: 10 }],
        ["t3", { spool: "spool_b", spoolJoined: 30 }],
      ]),
    });
    expect(spools.map((s) => s.id)).toEqual(["spool_b"]);
    expect(membershipByThreadId.get("t1")).toBeUndefined();
  });

  it("ignores metadata that does not carry a spool id", () => {
    const { spools, membershipByThreadId } = deriveSpools({
      threads: [thread("t1")],
      metadataByThreadId: new Map([["t1", { hoverHint: true }]]),
    });
    expect(spools).toEqual([]);
    expect(membershipByThreadId.size).toBe(0);
  });
});

describe("familyOf", () => {
  it("walks descendants breadth-first, including the root", () => {
    const childrenOf = new Map([
      ["t1", ["t2", "t3"]],
      ["t2", ["t4"]],
      ["t3", []],
    ]);
    expect(familyOf({ threadId: "t1", childrenOf })).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("survives cycles", () => {
    const childrenOf = new Map([
      ["t1", ["t2"]],
      ["t2", ["t1"]],
    ]);
    expect(familyOf({ threadId: "t1", childrenOf })).toEqual(["t1", "t2"]);
  });
});

describe("planMetadataWrites", () => {
  it("create: stamps every member, freezes the lead's title once, name only later", () => {
    const writes = planMetadataWrites(
      {
        kind: "create",
        spoolId: "spool_x",
        memberIds: ["t1", "t2"],
        leadId: "t1",
        leadTitle: "Alpha",
        joinedAt: 1000,
      },
      new Map(),
    );
    expect(writes).toEqual([
      {
        // The derived name is frozen into spoolTitle at creation and never
        // re-derived — no later add or lead rename can retitle the spool.
        threadId: "t1",
        set: { spool: "spool_x", spoolJoined: 1000, spoolLead: true, spoolTitle: "Spool: Alpha" },
      },
      {
        threadId: "t2",
        set: { spool: "spool_x", spoolJoined: 1001, spoolLead: false },
        remove: ["spoolTitle"],
      },
    ]);
  });

  it("create freezes a user-supplied name instead of the derived one", () => {
    const writes = planMetadataWrites(
      {
        kind: "create",
        spoolId: "spool_x",
        memberIds: ["t1"],
        leadId: "t1",
        leadTitle: "Alpha",
        customTitle: "  Fuzz  ",
        joinedAt: 1000,
      },
      new Map(),
    );
    expect(writes[0].set).toMatchObject({ spoolTitle: "Fuzz" });
  });

  it("create without a resolvable lead title freezes “Unnamed spool”", () => {
    const writes = planMetadataWrites(
      {
        kind: "create",
        spoolId: "spool_x",
        memberIds: ["t1"],
        leadId: "t1",
        joinedAt: 1000,
      },
      new Map(),
    );
    expect(writes[0].set).toMatchObject({ spoolTitle: "Unnamed spool" });
  });

  it("create keeps a custom title on the lead only", () => {
    const writes = planMetadataWrites(
      {
        kind: "create",
        spoolId: "spool_x",
        memberIds: ["t1", "t2"],
        leadId: "t1",
        customTitle: "Fuzz",
        joinedAt: 1000,
      },
      new Map(),
    );
    expect(writes[0].set).toMatchObject({ spoolTitle: "Fuzz" });
    expect(writes[1].remove).toContain("spoolTitle");
  });

  it("add clears stale lead/title keys (break-out safety)", () => {
    const membership = new Map([
      [
        "t1",
        { id: "spool_old", joined: 5, lead: true },
      ],
    ]);
    const writes = planMetadataWrites(
      { kind: "add", spoolId: "spool_new", memberIds: ["t1"], joinedAt: 50 },
      membership as never,
    ) as SpoolMetadataWrite[];
    expect(writes[0]).toEqual({
      threadId: "t1",
      set: { spool: "spool_new", spoolJoined: 50, spoolLead: false },
      remove: ["spoolTitle"],
    });
  });

  it("unspool releases every spool key", () => {
    const writes = planMetadataWrites(
      { kind: "unspool", spoolId: "spool_a", memberIds: ["t1", "t2"] },
      new Map(),
    );
    expect(writes).toEqual([
      { threadId: "t1", remove: ["spool", "spoolJoined", "spoolLead", "spoolTitle"] },
      { threadId: "t2", remove: ["spool", "spoolJoined", "spoolLead", "spoolTitle"] },
    ]);
  });

  it("rename writes the custom title to the lead; clearing re-freezes the current name", () => {
    const renamed = planMetadataWrites(
      { kind: "rename", memberIds: ["t1", "t2"], leadId: "t1", customTitle: "Named" },
      new Map(),
    );
    expect(renamed).toEqual([{ threadId: "t1", set: { spoolTitle: "Named" } }]);

    // Clearing must not fall back to live derivation — that path would let
    // later adds and lead renames retitle the spool again. It freezes the
    // currently derived value instead, same as creation does.
    const cleared = planMetadataWrites(
      { kind: "rename", memberIds: ["t1", "t2"], leadId: "t1", customTitle: "", derivedTitle: "Spool: Alpha" },
      new Map(),
    );
    expect(cleared).toEqual([{ threadId: "t1", set: { spoolTitle: "Spool: Alpha" } }]);

    const clearedNameless = planMetadataWrites(
      { kind: "rename", memberIds: ["t1"], leadId: "t1", customTitle: null, derivedTitle: null },
      new Map(),
    );
    expect(clearedNameless).toEqual([{ threadId: "t1", set: { spoolTitle: "Unnamed spool" } }]);
  });
});

describe("title lifecycle: named once, never again", () => {
  it("locks the name at creation; adds, lead renames and handovers never retitle", () => {
    // Phase 1 — create. The lead's current title freezes immediately.
    const meta = new Map<string, Record<string, unknown>>([
      ["alpha", { spool: "spool_a", spoolJoined: 1, spoolLead: true, spoolTitle: "Spool: Login fix" }],
    ]);
    const threads = (titles: Record<string, string>) =>
      Object.entries(titles).map(([id, name]) => thread(id, name));

    const afterCreate = deriveSpools({
      threads: threads({ alpha: "Login fix", beta: "Add logging" }),
      metadataByThreadId: meta,
    });
    expect(afterCreate.spools[0].title).toBe("Spool: Login fix");

    // Phase 2 — add a member (even under add-to-top, the negative stamp
    // out-sorting the lead changes neither the lead nor the name).
    meta.set("beta", { spool: "spool_a", spoolJoined: -2_000 });
    const afterAdd = deriveSpools({
      threads: threads({ alpha: "Login fix", beta: "Add logging" }),
      metadataByThreadId: meta,
    });
    expect(afterAdd.spools[0].title).toBe("Spool: Login fix");
    expect(afterAdd.spools[0].leadThreadId).toBe("alpha");

    // Phase 3 — the user renames the spool: the new name replaces the frozen
    // one and sticks (the plan writes the lead only).
    const rename = planMetadataWrites(
      { kind: "rename", memberIds: ["alpha", "beta"], leadId: "alpha", customTitle: "Auth sprint", derivedTitle: "Spool: Login fix" },
      afterAdd.membershipByThreadId,
    );
    expect(rename).toEqual([{ threadId: "alpha", set: { spoolTitle: "Auth sprint" } }]);
    meta.set("alpha", {
      ...meta.get("alpha")!,
      spoolTitle: "Auth sprint",
    });
    const afterRename = deriveSpools({
      threads: threads({ alpha: "Login fix", beta: "Add logging" }),
      metadataByThreadId: meta,
    });
    expect(afterRename.spools[0].title).toBe("Auth sprint");

    // Phase 4 — more adds, and even the lead thread's own title changing in
    // the thread list, must leave the name alone.
    meta.set("gamma", { spool: "spool_a", spoolJoined: -3_000 });
    const memory = ["alpha", "beta", "gamma"];
    expect(
      deriveSpools({
        threads: threads({ alpha: "Everything changed", beta: "Add logging", gamma: "Gamma" }),
        metadataByThreadId: new Map(memory.map((id) => [id, meta.get(id)!])),
      }).spools[0].title,
    ).toBe("Auth sprint");
    expect(
      deriveSpools({
        threads: threads({ alpha: "Everything changed", beta: "Add logging", gamma: "Gamma" }),
        metadataByThreadId: new Map(memory.map((id) => [id, meta.get(id)!])),
      }).spools[0].leadThreadId,
    ).toBe("alpha");
  });

  it("a spool born before titles were frozen: the first add locks its current name", () => {
    // Legacy install state — no spoolTitle anywhere, lead persisted. The
    // card still shows the derived name; the first add must freeze exactly
    // what is showing (and nothing more once customTitle exists).
    const spool = deriveSpools({
      threads: [thread("t1", "Alpha"), thread("t2", "Beta")],
      metadataByThreadId: new Map([
        ["t1", { spool: "spool_a", spoolJoined: 1, spoolLead: true }],
        ["t2", { spool: "spool_a", spoolJoined: 2 }],
      ]),
    }).spools[0];
    const before = planAddReconcile(spool);
    expect(before).toEqual([{ threadId: "t1", set: { spoolTitle: "Spool: Alpha" } }]);
    // Once the title exists, adds stop producing reconcile writes.
    const after = planAddReconcile({ ...spool, customTitle: "Spool: Alpha", title: "Spool: Alpha" });
    expect(after).toEqual([]);
  });

  it("an ELECTED (lead-less) legacy spool: the first add freezes its shown name and persists its lead", () => {
    const spool = deriveSpools({
      threads: [thread("t1", "Alpha"), thread("t2", "Beta")],
      metadataByThreadId: new Map([
        ["t1", { spool: "spool_a", spoolJoined: 10 }],
        ["t2", { spool: "spool_a", spoolJoined: 20 }],
      ]),
    }).spools[0];
    expect(spool.leadElected).toBe(true);
    expect(planAddReconcile(spool)).toEqual([
      { threadId: "t1", set: { spoolLead: true, spoolTitle: "Spool: Alpha" } },
    ]);
  });

  describe("planAddReconcile", () => {
  it("freezes a still-derived title and persists an elected lead", () => {
    const writes = planAddReconcile({
      leadThreadId: "t2",
      leadElected: true,
      customTitle: null,
      title: "Spool: Beta",
    });
    // Both holes sit on the same lead — one merged write.
    expect(writes).toEqual([{ threadId: "t2", set: { spoolLead: true, spoolTitle: "Spool: Beta" } }]);
  });

  it("writes nothing once the spool has a real lead and a frozen title", () => {
    const writes = planAddReconcile({
      leadThreadId: "t1",
      leadElected: false,
      customTitle: "Named",
      title: "Named",
    });
    expect(writes).toEqual([]);
  });

  it("tolerates a missing spool (first add after creation)", () => {
    expect(planAddReconcile(null)).toEqual([]);
    expect(planAddReconcile(undefined)).toEqual([]);
  });
  });
});

describe("planLeadMigration", () => {
  it("migrates the custom title AND persists spoolLead on the next member", () => {
    const writes = planLeadMigration({
      spoolId: "spool_a",
      memberIds: ["t1", "t2", "t3"],
      leavingLeadId: "t1",
      oldLeadCustomTitle: "Fuzz",
      joinedAt: 10,
    });
    expect(writes).toEqual([{ threadId: "t2", set: { spoolTitle: "Fuzz", spoolLead: true } }]);
  });

  it("still persists spoolLead even when the old lead had no custom title", () => {
    const writes = planLeadMigration({
      spoolId: "spool_a",
      memberIds: ["t1", "t2"],
      leavingLeadId: "t1",
      oldLeadCustomTitle: null,
      joinedAt: 10,
    });
    expect(writes).toEqual([{ threadId: "t2", set: { spoolLead: true } }]);
  });

  it("is a no-op for a spool that lost its last member", () => {
    const writes = planLeadMigration({
      spoolId: "spool_a",
      memberIds: ["t1"],
      leavingLeadId: "t1",
      oldLeadCustomTitle: "Fuzz",
      joinedAt: 10,
    });
    expect(writes).toEqual([]);
  });
});

describe("misc", () => {
  it("newSpoolId uses the spool_ prefix and 8 hex chars", () => {
    const id = newSpoolId();
    expect(id).toMatch(/^spool_[0-9a-f]{8}$/);
  });

  it("releasePatch removes the whole spool key-set", () => {
    expect(releasePatch().remove).toEqual(["spool", "spoolJoined", "spoolLead", "spoolTitle"]);
  });

  it("spoolTitleFor trims custom titles and falls back to the lead", () => {
    expect(spoolTitleFor({ id: "t", displayTitle: "Alpha", title: "Alpha" }, "  ")).toBe(
      "Spool: Alpha",
    );
    expect(spoolTitleFor(null, "Solo")).toBe("Solo");
  });

  it("a spool whose lead thread is gone never renders an empty title", () => {
    // A deleted (or otherwise unresolvable) lead leaves the derived base
    // empty — the card used to render "Spool: " as a title-less button.
    expect(spoolTitleFor(null, null)).toBe("Unnamed spool");
    expect(
      spoolTitleFor({ id: "t", displayTitle: "  ", title: null }, null),
    ).toBe("Unnamed spool");
  });

  it("derives the title from the first member when the lead is unresolvable", () => {
    // Membership metadata survives its lead thread being deleted; the
    // remaining members still describe the spool.
    const { spools } = deriveSpools({
      threads: [
        thread("m1", "Survivor"),
        thread("m2", "Second"),
      ],
      metadataByThreadId: new Map([
        ["m1", { spool: "spool_abc", spoolJoined: 10 }],
        ["m2", { spool: "spool_abc", spoolJoined: 5 }],
      ]),
    });
    expect(spools).toHaveLength(1);
    // No member carries spoolLead, so the first-seen member (oldest join)
    // is elected and titles the spool; the election is flagged so the next
    // add can persist it.
    expect(spools[0]?.leadThreadId).toBe("m2");
    expect(spools[0]?.title).toBe("Spool: Second");
    expect(spools[0]?.leadElected).toBe(true);
  });

  it("flags spoolLead metadata as a real (non-elected) lead", () => {
    const { spools } = deriveSpools({
      threads: [thread("t1", "Alpha")],
      metadataByThreadId: new Map([
        ["t1", { spool: "spool_abc", spoolJoined: 1, spoolLead: true, spoolTitle: "Frozen" }],
      ]),
    });
    expect(spools[0]?.leadElected).toBe(false);
    expect(spools[0]?.title).toBe("Frozen");
  });
});
