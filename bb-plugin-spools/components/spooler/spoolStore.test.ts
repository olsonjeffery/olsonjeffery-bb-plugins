import { describe, expect, it } from "vitest";
import {
  deriveSpools,
  familyOf,
  newSpoolId,
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
  it("create: stamps every member, lead flag and joined order only once", () => {
    const writes = planMetadataWrites(
      {
        kind: "create",
        spoolId: "spool_x",
        memberIds: ["t1", "t2"],
        leadId: "t1",
        joinedAt: 1000,
      },
      new Map(),
    );
    expect(writes).toEqual([
      {
        threadId: "t1",
        set: { spool: "spool_x", spoolJoined: 1000, spoolLead: true },
        remove: ["spoolTitle"],
      },
      {
        threadId: "t2",
        set: { spool: "spool_x", spoolJoined: 1001, spoolLead: false },
        remove: ["spoolTitle"],
      },
    ]);
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

  it("rename writes the custom title to the lead; clearing restores derivation", () => {
    const renamed = planMetadataWrites(
      { kind: "rename", memberIds: ["t1", "t2"], leadId: "t1", customTitle: "Named" },
      new Map(),
    );
    expect(renamed).toEqual([{ threadId: "t1", set: { spoolTitle: "Named" } }]);

    const cleared = planMetadataWrites(
      { kind: "rename", memberIds: ["t1", "t2"], leadId: "t1", customTitle: "" },
      new Map(),
    );
    expect(cleared).toEqual([{ threadId: "t1", remove: ["spoolTitle"] }]);
  });
});

describe("planLeadMigration", () => {
  it("migrates an existing custom title to the next member", () => {
    const writes = planLeadMigration({
      spoolId: "spool_a",
      memberIds: ["t1", "t2", "t3"],
      leavingLeadId: "t1",
      oldLeadCustomTitle: "Fuzz",
      joinedAt: 10,
    });
    expect(writes).toEqual([{ threadId: "t2", set: { spoolTitle: "Fuzz" } }]);
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
});
