import { useRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { swipeActionView, type SwipeActionView } from "@/lib/swipe";
import { useRowSwipe } from "./useRowSwipe";

const readAction = swipeActionView("read", {
  isUnread: true, isPinned: false, isArchived: false,
})!;
const archiveAction = swipeActionView("archive", {
  isUnread: false, isPinned: false, isArchived: false,
})!;

function SwipeRow({
  enabled = true,
  right = readAction,
  onCommit,
  onOpen,
}: {
  enabled?: boolean;
  right?: SwipeActionView;
  onCommit: (action: SwipeActionView, offset: number) => void;
  onOpen: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const reveal = useRowSwipe({
    rowRef, enabled, right, left: null, restoreKey: "active", onCommit,
  });
  return (
    <div ref={rowRef} data-testid="row">
      {reveal?.action ? (
        <button className="spooler-swipe-underlay">{reveal.action.label}</button>
      ) : null}
      <a href="#thread" onClick={(event) => { event.preventDefault(); onOpen(); }}>
        Thread
      </a>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  // Finish springs synchronously; timer-driven trackpad release still runs.
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.spyOn(performance, "now").mockReturnValue(0);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function touchSwipe(row: HTMLElement, travel = 120) {
  fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 100 }] });
  // The first horizontal move locks the gesture; travel starts there.
  fireEvent.touchMove(row, { touches: [{ clientX: 120, clientY: 100 }] });
  fireEvent.touchMove(row, { touches: [{ clientX: 120 + travel, clientY: 100 }] });
  fireEvent.touchEnd(row, { touches: [] });
}

function openByTrackpad(row: HTMLElement) {
  for (let i = 0; i < 3; i++) fireEvent.wheel(row, { deltaX: -20, deltaY: 0 });
  act(() => { vi.advanceTimersByTime(260); });
}

describe("row-scoped swipe click capture", () => {
  it("does not install window click handlers or inspect rows on unrelated clicks", () => {
    const windowListeners = vi.spyOn(window, "addEventListener");
    const onCommit = vi.fn();
    const onOpen = vi.fn();
    const slot = render(<>{Array.from({ length: 20 }, (_, i) => (
      <SwipeRow key={i} onCommit={onCommit} onOpen={onOpen} />
    ))}</>);
    expect(windowListeners.mock.calls.filter(([type]) => type === "click")).toHaveLength(0);
    const contains = Array.from(slot.container.querySelectorAll<HTMLDivElement>("[data-testid='row']"))
      .map((row) => vi.spyOn(row, "contains"));
    fireEvent.click(document.body);
    for (const spy of contains) expect(spy).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("allows normal link clicks but suppresses the click after a committed swipe", () => {
    const onCommit = vi.fn();
    const onOpen = vi.fn();
    const slot = render(<SwipeRow onCommit={onCommit} onOpen={onOpen} />);
    const link = slot.getByRole("link");
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledOnce();
    touchSwipe(slot.getByTestId("row"));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(readAction, 120);
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledOnce();
    vi.mocked(performance.now).mockReturnValue(401);
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("does not suppress unrelated clicks during the post-swipe window", () => {
    const onCommit = vi.fn();
    const onOpen = vi.fn();
    const outside = vi.fn();
    const slot = render(<>
      <SwipeRow onCommit={onCommit} onOpen={onOpen} />
      <button onClick={outside}>Outside</button>
    </>);
    touchSwipe(slot.getByTestId("row"));
    expect(onCommit).toHaveBeenCalledOnce();
    fireEvent.click(slot.getByRole("button", { name: "Outside" }));
    expect(outside).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("commits an open trackpad action before link handling", () => {
    const onCommit = vi.fn();
    const onOpen = vi.fn();
    const slot = render(<SwipeRow onCommit={onCommit} onOpen={onOpen} />);
    openByTrackpad(slot.getByTestId("row"));
    expect(slot.getByTestId("row").dataset.swipePhase).toBe("open");
    fireEvent.click(slot.getByRole("button", { name: "Read" }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(readAction, 96);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("closes an open row on a row press without opening its link", () => {
    const onCommit = vi.fn();
    const onOpen = vi.fn();
    const slot = render(<SwipeRow onCommit={onCommit} onOpen={onOpen} />);
    openByTrackpad(slot.getByTestId("row"));
    fireEvent.pointerDown(slot.getByRole("link"));
    fireEvent.click(slot.getByRole("link"));
    expect(slot.getByTestId("row").dataset.swipePhase).toBeUndefined();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("removes gesture and click listeners when disabled", () => {
    const onCommit = vi.fn();
    const onOpen = vi.fn();
    const slot = render(<SwipeRow onCommit={onCommit} onOpen={onOpen} />);
    touchSwipe(slot.getByTestId("row"));
    slot.rerender(<SwipeRow enabled={false} onCommit={onCommit} onOpen={onOpen} />);
    touchSwipe(slot.getByTestId("row"));
    fireEvent.click(slot.getByRole("link"));
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
    expect(slot.getByTestId("row").style.transform).toBe("");
  });

  it("delivers a committed removal exactly once if the row becomes hidden mid-fold", () => {
    const onCommit = vi.fn();
    const onOpen = vi.fn();
    const slot = render(<SwipeRow right={archiveAction} onCommit={onCommit} onOpen={onOpen} />);
    touchSwipe(slot.getByTestId("row"));
    expect(onCommit).not.toHaveBeenCalled();
    slot.rerender(<SwipeRow enabled={false} right={archiveAction} onCommit={onCommit} onOpen={onOpen} />);
    act(() => { vi.runAllTimers(); });
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it("leaves vertical scrolling alone", () => {
    const onCommit = vi.fn();
    const slot = render(<SwipeRow onCommit={onCommit} onOpen={() => {}} />);
    const row = slot.getByTestId("row");
    fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 100 }] });
    const move = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(move, "touches", { value: [{ clientX: 102, clientY: 150 }] });
    fireEvent(row, move);
    fireEvent.touchEnd(row, { touches: [] });
    expect(move.defaultPrevented).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
    expect(row.style.transform).toBe("");
  });
});
