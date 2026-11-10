// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement as h, type ReactNode } from "react";
import { SpoolCard } from "./SpoolCard";
import { type RolledUpTag } from "./threadTags";
import { makeThread } from "./fixtures";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

// The card resolves the lead thread's PR and opens PR links through host
// navigate; both are runtime hooks that need a stub in tests.
const sdkStub = vi.hoisted(() => ({
  pullRequest: null as null | {
    number: number;
    title: string;
    url: string;
    state: "closed" | "draft" | "merged" | "open";
    attention: string;
  },
  openUrl: vi.fn(),
}));
vi.mock("./usePullRequest", () => ({
  useEnvironmentPullRequest: () => sdkStub.pullRequest,
}));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useBbNavigate: () => ({ openUrl: sdkStub.openUrl }),
  };
});

beforeEach(() => {
  sdkStub.pullRequest = null;
  sdkStub.openUrl.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Fixture threads with tidy distinct titles for peek/button assertions. */
function member(
  id: string,
  indicator: "none" | "waiting-for-input" | "unread-error" = "none",
): PluginSidebarThread {
  return makeThread({ id, title: `Member ${id}`, indicator });
}

type PropsForTest = Parameters<typeof SpoolCard>[0];

function makeProps(partial: Partial<PropsForTest> = {}): PropsForTest {
  return {
    data: {
      id: "spool1",
      label: "Spool: Alpha",
      customTitle: null,
      leadThreadId: "t1",
      members: [member("t1"), member("t2"), member("t3", "waiting-for-input")],
      total: 3,
      unread: 0,
      live: 0,
      needsUser: 1,
      failed: 0,
    },
    collapsed: false,
    onToggle: vi.fn(),
    onOpen: vi.fn(),
    onOpenTop: vi.fn(),
    onOpenMenu: vi.fn(),
    onContextMenu: vi.fn(),
    isRenaming: false,
    onRenameCommit: vi.fn(),
    onRenameCancel: vi.fn(),
    startRename: vi.fn(),
    renderMember: (thread: PluginSidebarThread): ReactNode =>
      h("div", { "data-testid": `member-${thread.id}` }, thread.displayTitle),
    projectNameFor: (thread: PluginSidebarThread): string =>
      `P:${thread.projectId}`,
    ...partial,
  };
}

function renderEl(props: PropsForTest) {
  return render(h(SpoolCard, props));
}

describe("SpoolCard", () => {
  it("renders the label, member count chip, labelled group, and all members in order", () => {
    const memberSpy = vi.fn(
      (thread: PluginSidebarThread, index: number, isLast: boolean) =>
        h(
          "div",
          { "data-testid": `member-${thread.id}` },
          `${thread.displayTitle} ${index} ${isLast ? "last" : ""}`,
        ),
    );
    renderEl(makeProps({ renderMember: memberSpy }));

    expect(
      screen.getByRole("group", { name: "Spool Spool: Alpha, 3 threads" }),
    ).toBeTruthy();
    expect(screen.getByText("Spool: Alpha")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByTestId("member-t1")).toBeTruthy();
    expect(screen.getByTestId("member-t2")).toBeTruthy();
    expect(screen.getByTestId("member-t3")).toBeTruthy();
    // Member parity: index/isLast are wired through, last member flagged.
    const lastArgs = memberSpy.mock.calls.at(-1)!;
    expect(lastArgs[0].id).toBe("t3");
    expect(lastArgs[1]).toBe(2);
    expect(lastArgs[2]).toBe(true);
  });

  it("single-click on the title toggles via onToggle", () => {
    const onToggle = vi.fn();
    renderEl(makeProps({ onToggle }));
    fireEvent.click(screen.getByRole("button", { name: "Spool: Alpha" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("clicking the header background (badges line) toggles via onToggle exactly once", () => {
    const onToggle = vi.fn();
    const { container } = render(
      h(SpoolCard, makeProps({ onToggle })),
    );
    fireEvent.click(
      container.querySelector(".spooler-spool-header") as HTMLElement,
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("clicking the header background while renaming does not toggle", () => {
    const onToggle = vi.fn();
    const { container } = render(
      h(SpoolCard, makeProps({ onToggle, isRenaming: true })),
    );
    fireEvent.click(
      container.querySelector(".spooler-spool-header") as HTMLElement,
    );
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("double-clicking the title starts rename; Enter commits, Escape cancels", () => {
    const startRename = vi.fn();
    const onRenameCommit = vi.fn();
    const onRenameCancel = vi.fn();
    const props = makeProps({ startRename, onRenameCommit, onRenameCancel });
    const slot = renderEl(props);

    // Not renaming yet: no input.
    expect(screen.queryByLabelText("Rename spool")).toBeNull();
    fireEvent.dblClick(screen.getByRole("button", { name: "Spool: Alpha" }));
    expect(startRename).toHaveBeenCalledTimes(1);

    // Parent accepts rename: input appears seeded with the resolved label.
    slot.rerender(h(SpoolCard, { ...props, isRenaming: true }));
    const input = screen.getByLabelText("Rename spool") as HTMLInputElement;
    expect(input.value).toBe("Spool: Alpha");
    fireEvent.change(input, { target: { value: "My Heap" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameCommit).toHaveBeenCalledWith("My Heap");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRenameCancel).toHaveBeenCalledTimes(1);
  });

  it("hints a rename affordance on the derived label while customTitle is null", () => {
    renderEl(makeProps());
    const titleBtn = screen.getByRole("button", { name: "Spool: Alpha" });
    expect(titleBtn.getAttribute("title")).toContain("double-click to rename");
  });

  it("the Layers icon opens the top thread via onOpenTop with a hover hint", () => {
    const onOpenTop = vi.fn();
    renderEl(makeProps({ onOpenTop }));
    const icon = screen.getByRole("button", { name: "Open top thread" });
    expect(icon.getAttribute("title")).toBe("Open top thread");
    fireEvent.click(icon);
    expect(onOpenTop).toHaveBeenCalledWith("t1");
  });

  it("the ellipsis button opens the spool menu via onOpenMenu", () => {
    const onOpenMenu = vi.fn();
    renderEl(makeProps({ onOpenMenu }));
    fireEvent.click(screen.getByRole("button", { name: "Spool actions" }));
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    // The card must not also treat it as a plain card click.
    const [eventArg] = onOpenMenu.mock.calls[0]!;
    expect(eventArg.stopPropagation).toBeDefined();
  });

  it("drops the grip: no drag affordance, and the glyph shows without hover swaps", () => {
    renderEl(makeProps());
    const card = document.querySelector('[data-spool-id="spool1"]')!;
    expect(card).toBeTruthy();
    expect(card.className).not.toContain("spooler-spool-drop-active");
    expect(document.querySelector(".spooler-row-grip")).toBeNull();
    // Relocation goes through the ⋯ menu; the spool glyph is just the mark.
    const glyph = screen.getByRole("button", { name: "Open top thread" });
    fireEvent.click(glyph);
    expect(document.querySelector(".spooler-spool-icon")).toBeTruthy();
  });

  it("the pip is a count again: not buttoned, not the actions trigger", () => {
    renderEl(makeProps());
    const pip = document.querySelector(".spooler-spool-pip") as HTMLElement;
    expect(pip?.querySelectorAll("button").length).toBe(0);
    expect(screen.getByText("3")).toBeTruthy();
    // Ellipsis sits left of the "Spool" meta text within the trailing cluster.
    const trail = document.querySelector(".spooler-spool-trail") as HTMLElement;
    const kids = Array.from(trail.children).map((el) => el.className);
    expect(kids[0]).toContain("spooler-spool-more");
    expect(kids[1]).toContain("spooler-spool-meta");
  });

  it("carries the active-row tint only while collapsed with the viewed thread inside", () => {
    const view = renderEl(
      makeProps({ collapsed: true, hasActiveThread: true }),
    );
    const card = () => document.querySelector('[data-spool-id="spool1"]')!;
    expect(card().className).toContain("spooler-spool-card-active");
    // Expanded: the members' own active rows carry the tint instead.
    view.rerender(
      h(SpoolCard, makeProps({ collapsed: false, hasActiveThread: true })),
    );
    expect(card().className).not.toContain("spooler-spool-card-active");
    // Collapsed, but the viewed thread is elsewhere: a plain card.
    view.rerender(
      h(SpoolCard, makeProps({ collapsed: true, hasActiveThread: false })),
    );
    expect(card().className).not.toContain("spooler-spool-card-active");
  });

  describe("collapsed badges", () => {
    it("keeps no project/branch chips on the header — the meta line is Spool", () => {
      const props = makeProps({
        collapsed: true,
        data: {
          ...makeProps().data,
          members: [
            { ...member("t1"), projectId: "proj_a" },
            { ...member("t2"), projectId: "proj_b" },
          ],
        },
      });
      renderEl(props);
      // The glance header reads the spool itself; member rows carry projects.
      expect(screen.queryByText("P:proj_a")).toBeNull();
      expect(screen.queryByText(/2 projects/)).toBeNull();
      // The spool header's meta read: "Spool" (and "Spool · N working"
      // when members are running).
      expect(screen.getByText("Spool")).toBeTruthy();
    });

    it("keeps no branch/PR badges on the spool header", () => {
      const branched = () =>
        makeThread({
          id: "t9",
          title: "Member t9",
          environment: {
            id: "env_t9",
            name: null,
            branchName: "feat/spool",
            path: null,
            isWorktree: false,
            providerId: "project-checkout",
            workspaceDisplayKind: null,
          },
        });
      sdkStub.pullRequest = {
        number: 42,
        title: "Fix spools",
        url: "https://github.com/o/r/pull/42",
        state: "open",
        attention: "checks_pending",
      };
      const onToggle = vi.fn();
      renderEl(
        makeProps({
          collapsed: true,
          onToggle,
          data: {
            ...makeProps().data,
            members: [branched(), branched()],
          },
        }),
      );
      // Branches and PRs are per-member facts now: off the glance header.
      expect(screen.queryByText("feat/spool")).toBeNull();
      expect(screen.queryByRole("button", { name: /Open pull request 42/ })).toBeNull();
      cleanup();

      sdkStub.pullRequest = null;
      renderEl(
        makeProps({
          collapsed: false,
          data: {
            ...makeProps().data,
            members: [branched(), branched()],
          },
        }),
      );
      expect(screen.queryByText("feat/spool")).toBeNull();
    });

    it("rides working liveness in the count pip while collapsed", () => {
      const running = (): PluginSidebarThread =>
        makeThread({ id: "tw1", title: "Member tw1", indicator: "runtime" });
      renderEl(
        makeProps({
          collapsed: true,
          data: {
            ...makeProps().data,
            members: [running(), running(), member("t3")],
          },
        }),
      );
      // The pip grammar the section headers use: the count numeral sits in
      // the pip with a green spinner behind it — no separate text badge.
      const pip = document.querySelector(
        ".spooler-spool-pip .spooler-spool-count",
      ) as HTMLElement;
      expect(pip).toBeTruthy();
      expect(
        pip.querySelector(
          ".spooler-spool-pip-status.spooler-spinner.spooler-tone-success",
        ),
      ).toBeTruthy();
      const numeral = pip.querySelector(
        ".spooler-pip-numeral",
      ) as HTMLElement;
      expect(numeral).toBeTruthy();
      expect(numeral.textContent?.trim()).toBe("3");
      expect(document.querySelector(".spooler-spool-workcount")).toBeNull();
    });

    it("keeps the pip spinner while expanded (the section grammar shows it regardless)", () => {
      const running = (): PluginSidebarThread =>
        makeThread({ id: "tw2", title: "Member tw2", indicator: "runtime" });
      renderEl(
        makeProps({
          collapsed: false,
          data: {
            ...makeProps().data,
            members: [running(), running()],
          },
        }),
      );
      const pip = document.querySelector(
        ".spooler-spool-pip .spooler-spool-count",
      ) as HTMLElement;
      expect(
        pip.querySelector(
          ".spooler-spool-pip-status.spooler-spinner.spooler-tone-success",
        ),
      ).toBeTruthy();
      // The pip overlay persists in either state; the meta line carries
      // "Spool · 2 working".
      expect(
        pip.querySelector(
          ".spooler-spool-pip-status.spooler-spinner.spooler-tone-success",
        ),
      ).toBeTruthy();
      expect(screen.getByText(/Spool · 2 working/)).toBeTruthy();
    });

  });
});

describe("SpoolCard — tag rollup", () => {
  const tags = {
    urgent: { id: "urgent", label: "🔥", color: "#ef4444" },
    review: { id: "review", label: "👀", color: "#6b7280" },
    done: { id: "done", label: "✅", color: "#22c55e" },
    blocked: { id: "blocked", label: "⛔", color: "#111827" },
    queued: { id: "queued", label: "🧠", color: "#10b981" },
  };

  function rollupTag(
    id: string,
    wornBy: number,
    priority: number,
  ): RolledUpTag {
    return { tag: tags[id as keyof typeof tags]!, wornBy, priority };
  }

  it("rides the rolled-up badges on the title bar before the meta cluster", () => {
    renderEl(
      makeProps({
        tagRollup: [rollupTag("urgent", 2, 4), rollupTag("review", 1, 0)],
      }),
    );
    const lane = document.querySelector(".spooler-spool-tags") as HTMLElement;
    expect(
      (lane.parentElement as HTMLElement).className,
    ).toContain("spooler-spool-header");
    const badges = Array.from(
      lane.querySelectorAll(".spooler-tag-badge"),
    ) as HTMLElement[];
    expect(badges.map((badge) => badge.textContent)).toEqual(["🔥", "👀"]);
    expect(document.querySelector(".spooler-spool-tag-overflow")).toBeNull();
  });

  it("caps the badges and shows the +N overflow with the remaining labels", () => {
    renderEl(
      makeProps({
        tagRollup: [
          rollupTag("urgent", 1, 4),
          rollupTag("review", 1, 3),
          rollupTag("done", 1, 2),
          rollupTag("blocked", 1, 1),
          rollupTag("queued", 1, 0),
        ],
      }),
    );
    const lane = document.querySelector(".spooler-spool-tags") as HTMLElement;
    const badges = lane.querySelectorAll(".spooler-tag-badge");
    expect(badges.length).toBe(4);
    const overflow = lane.querySelector(
      ".spooler-spool-tag-overflow",
    ) as HTMLElement;
    expect(overflow!.textContent).toBe("+1");
    expect(overflow!.title).toBe("🧠");
  });

  it("renders nothing when members wear no tags", () => {
    renderEl(makeProps({ tagRollup: [] }));
    expect(document.querySelector(".spooler-spool-tags")).toBeNull();
  });
});
