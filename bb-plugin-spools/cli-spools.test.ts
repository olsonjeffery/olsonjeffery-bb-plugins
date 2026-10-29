import { describe, expect, it, vi } from "vitest";
import {
  findSectionId,
  findSpool,
  findThread,
  listBody,
  type SpoolThread,
  type SpoolWorld,
} from "./cli-spools";


function thread(
  id: string,
  over: Partial<SpoolThread> = {},
): SpoolThread {
  return {
    id,
    title: `Thread ${id}`,
    displayTitle: `Thread ${id}`,
    sectionId: "sec1",
    parentThreadId: null,
    ...over,
  };
}

function world(over: Partial<SpoolWorld> = {}): SpoolWorld {
  const threads = over.threads ?? [
    thread("aaaa1111"),
    thread("aaaa2222", { sectionId: null }),
    thread("bbbb3333", { parentThreadId: "aaaa1111" }),
  ];
  return {
    threads,
    threadById: new Map(threads.map((t) => [t.id, t])),
    sectionNameById:
      over.sectionNameById ?? new Map([["sec1", "Bugs"], ["sec2", "Bugs2"]]),
    spools: over.spools ?? [],
    membership: over.membership ?? new Map(),
    childrenOf: over.childrenOf ?? new Map(),
    ...over,
  };
}

describe("spools CLI resolvers", () => {
  it("findThread prefers exact id, then unique prefix, then unique title", () => {
    const w = world();
    expect(findThread(w, "aaaa2222").id).toBe("aaaa2222");
    expect(findThread(w, "2222").id).toBe("aaaa2222");
    expect(findThread(w, "thread bbbb").id).toBe("bbbb3333");
  });

  it("findThread refuses ambiguous id prefixes", () => {
    const w = world();
    expect(() => findThread(w, "aaaa")).toThrowError(/matches several/);
  });

  it("findSpool matches exact id, id prefix, and 1-based index; errors clearly otherwise", () => {
    const w = world({
      spools: [
        {
          id: "spool_x1",
          members: ["aaaa1111"],
          leadThreadId: "aaaa1111",
          customTitle: null,
          leadElected: false,
          title: "Spool: Thread aaaa1111",
        },
        {
          id: "spool_y2",
          members: ["aaaa2222"],
          leadThreadId: "aaaa2222",
          customTitle: null,
          leadElected: false,
          title: "Spool: Thread aaaa2222",
        },
      ],
    });
    expect(findSpool(w, "spool_y2").id).toBe("spool_y2");
    expect(findSpool(w, "y2").id).toBe("spool_y2");
    expect(findSpool(w, "2").id).toBe("spool_y2");
    expect(() => findSpool(w, "z")).toThrowError(/No spool matches/);
  });

  it("findSectionId names uniquely (case-insensitive), unfiles on none/unfiled", () => {
    const w = world();
    expect(findSectionId(w, "none")).toBeNull();
    expect(findSectionId(w, "Unfiled")).toBeNull();
    expect(findSectionId(w, "bugs")).toBe("sec1");
    expect(findSectionId(w, "bugs2")).toBe("sec2");
    expect(() => findSectionId(w, "sec")).toThrowError(/No section matches/);
  });

  it("listBody prints indexed spools with member lines and sections", () => {
    const w = world({
      spools: [
        {
          id: "spool_top",
          members: ["aaaa1111", "aaaa2222"],
          leadThreadId: "aaaa1111",
          customTitle: null,
          leadElected: false,
          title: "Spool: Thread aaaa1111",
        },
      ],
    });
    const body = listBody(w);
    expect(body).toContain("1. Spool: Thread aaaa1111  (2)  spool_top");
    expect(body).toContain("- Thread aaaa1111 (Top)");
    expect(body).toContain("[Unfiled]");
  });
});
