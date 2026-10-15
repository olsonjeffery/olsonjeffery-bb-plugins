// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { createElement as h, type ReactNode } from "react";
import { SpoolCard } from "./SpoolCard";
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
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    experimental_useSidebarThreadPullRequest: () => ({
      isLoading: false,
      pullRequest: sdkStub.pullRequest,
    }),
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
    draggingThreadId: null,
    projectNameFor: (thread: PluginSidebarThread): string =>
      `P:${thread.projectId}`,
    ...partial,
  };
}

function renderEl(props: PropsForTest) {
  return render(h(DndContext, null, h(SpoolCard, props)));
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
      h(DndContext, null, h(SpoolCard, makeProps({ onToggle }))),
    );
    fireEvent.click(
      container.querySelector(".spooler-spool-header") as HTMLElement,
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("clicking the header background while renaming does not toggle", () => {
    const onToggle = vi.fn();
    const { container } = render(
      h(
        DndContext,
        null,
        h(SpoolCard, makeProps({ onToggle, isRenaming: true })),
      ),
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
    slot.rerender(h(DndContext, null, h(SpoolCard, { ...props, isRenaming: true })));
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

  it("renders inside a DndContext with draggable grip attributes and non-active droppable root", () => {
    renderEl(makeProps({ draggingThreadId: "t9" }));
    const card = document.querySelector('[data-spool-id="spool1"]')!;
    expect(card).toBeTruthy();
    expect(card.className).not.toContain("spooler-spool-drop-active");
    // Grip is a focusable button carrying dnd-kit's draggable attributes.
    const grip = screen.getByRole("button", {
      name: "Drag spool onto a section header to file its threads",
    }) as HTMLButtonElement;
    expect(grip.hasAttribute("aria-roledescription")).toBe(true);
    expect(grip.hasAttribute("aria-describedby")).toBe(true);
  });

  it("carries the active-row tint only while collapsed with the viewed thread inside", () => {
    const view = renderEl(
      makeProps({ collapsed: true, hasActiveThread: true }),
    );
    const card = () => document.querySelector('[data-spool-id="spool1"]')!;
    expect(card().className).toContain("spooler-spool-card-active");
    // Expanded: the members' own active rows carry the tint instead.
    view.rerender(
      h(
        DndContext,
        null,
        h(SpoolCard, makeProps({ collapsed: false, hasActiveThread: true })),
      ),
    );
    expect(card().className).not.toContain("spooler-spool-card-active");
    // Collapsed, but the viewed thread is elsewhere: a plain card.
    view.rerender(
      h(
        DndContext,
        null,
        h(SpoolCard, makeProps({ collapsed: true, hasActiveThread: false })),
      ),
    );
    expect(card().className).not.toContain("spooler-spool-card-active");
  });

  describe("peek panel", () => {
    it("appears on HEADER hover, lists member rows, then lingers ~500ms after leave", () => {
      vi.useFakeTimers();
      const slot = renderEl(makeProps());
      const card = document.querySelector('[data-spool-id="spool1"]')!;
      const header = card.querySelector<HTMLElement>(".spooler-spool-header")!;
      expect(screen.queryByRole("tooltip")).toBeNull();
      fireEvent.mouseEnter(header);
      const peek = screen.getByRole("tooltip");
      // Portaled: lives at document.body level, outside the mount container.
      expect(document.body.contains(peek)).toBe(true);
      expect(peek.parentElement).toBe(document.body);
      expect(slot.container.contains(peek)).toBe(false);
      expect(peek.style.position).toBe("fixed");
      expect(peek.textContent).toContain("Spool: Alpha");
      expect(peek.textContent).toContain("3 threads");
      expect(peek.textContent).toContain("Member t1");
      expect(peek.textContent).toContain("Member t2");
      expect(peek.textContent).toContain("Member t3");

      // Lingering: 400ms after leave it is still mounted.
      fireEvent.mouseLeave(header);
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(screen.getByRole("tooltip")).toBeTruthy();
      // Gone once the 500ms linger passes.
      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("members stay clickable while lingering; re-entry cancels the linger", () => {
      vi.useFakeTimers();
      const onOpen = vi.fn();
      renderEl(makeProps({ onOpen }));
      const card = document.querySelector('[data-spool-id="spool1"]')!;
      const header = card.querySelector<HTMLElement>(".spooler-spool-header")!;

      fireEvent.mouseEnter(header);
      fireEvent.mouseLeave(header);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      // Still lingering and clickable.
      fireEvent.click(screen.getByRole("button", { name: /Member t2/ }));
      expect(onOpen).toHaveBeenCalledWith("t2");
      // Re-enter clears the pending close entirely.
      fireEvent.mouseEnter(header);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByRole("tooltip")).toBeTruthy();
    });

    it("moving the pointer into the portaled peek itself also cancels the linger", () => {
      vi.useFakeTimers();
      renderEl(makeProps());
      const card = document.querySelector('[data-spool-id="spool1"]')!;
      const header = card.querySelector<HTMLElement>(".spooler-spool-header")!;

      fireEvent.mouseEnter(header);
      fireEvent.mouseLeave(header);
      act(() => {
        vi.advanceTimersByTime(200);
      });
      // Entering the peek (not just the card) must clear the pending close.
      fireEvent.mouseEnter(screen.getByRole("tooltip"));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByRole("tooltip")).toBeTruthy();
      // Leaving the peek again schedule the close normally.
      fireEvent.mouseLeave(screen.getByRole("tooltip"));
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("hovering the member list closes the peek at once — member rows show their own hover cards instead", () => {
      vi.useFakeTimers();
      renderEl(makeProps());
      const card = document.querySelector('[data-spool-id="spool1"]')!;
      const header = card.querySelector<HTMLElement>(".spooler-spool-header")!;
      const members = card.querySelector<HTMLElement>(
        ".spooler-spool-members",
      )!;
      fireEvent.mouseEnter(header);
      expect(screen.getByRole("tooltip")).toBeTruthy();
      // Down into the members: the spool peek must NOT linger in the way.
      fireEvent.mouseEnter(members);
      expect(screen.queryByRole("tooltip")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole("tooltip")).toBeNull();
    });
  });

  describe("collapsed badges", () => {
    it("shows a uniform-project chip and nothing on mixed projects but the fallback", () => {
      renderEl(makeProps({ collapsed: true }));
      expect(screen.getByText("P:proj_a")).toBeTruthy();
      cleanup();

      const mixed = makeProps({
        collapsed: true,
        data: {
          ...makeProps().data,
          members: [
            { ...member("t1"), projectId: "proj_a" },
            { ...member("t2"), projectId: "proj_b" },
          ],
        },
      });
      renderEl(mixed);
      expect(screen.getByText(/2 projects/)).toBeTruthy();
      expect(screen.queryByText("P:proj_a")).toBeNull();
    });

    it("shows a uniform-branch chip plus the lead thread's PR badge in both states", () => {
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
      expect(screen.getByText("feat/spool")).toBeTruthy();
      // The badges keep their own behavior — a PR click opens the PR instead
      // of fold-toggling the spool (round 11).
      fireEvent.click(screen.getByRole("button", { name: /Open pull request 42/ }));
      expect(onToggle).not.toHaveBeenCalled();
      expect(sdkStub.openUrl).toHaveBeenCalledWith(
        "https://github.com/o/r/pull/42",
      );
      expect(screen.getByText(/#42 ·/)).toBeTruthy();
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
      // Badges no longer vanish when the spool is folded open — the header
      // keeps its project / branch / PR context in both states.
      expect(screen.getAllByText("feat/spool").length).toBeGreaterThan(0);
    });

    it("shows the Working Thread Count (spinner + WORKING status word) while collapsed", () => {
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
      // Same badge anatomy the per-thread WORKING indicator uses.
      expect(screen.getByText("2 working")).toBeTruthy();
      const badge = document.querySelector(
        ".spooler-spool-badges .spooler-spool-workcount",
      ) as HTMLElement;
      expect(badge).toBeTruthy();
      expect(
        badge.querySelector(".spooler-spinner.spooler-tone-success"),
      ).toBeTruthy();
      expect(
        badge.querySelector(".spooler-status-word.spooler-tone-success"),
      ).toBeTruthy();
    });

    it("the Working Thread Count disappears when the spool is expanded", () => {
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
      expect(screen.queryByText(/working/)).toBeNull();
      expect(screen.queryByText("2 working")).toBeNull();
    });
  });
});
