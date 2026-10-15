import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThread } from "./fixtures";
import { useArrivals } from "./useArrivals";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("completion celebrations", () => {
  it("expires each completion despite intervening updates and overlapping batches", () => {
    vi.useFakeTimers();
    const a = makeThread({ id: "a", indicator: "runtime" });
    const b = makeThread({ id: "b", indicator: "runtime" });
    const doneA = { ...a, indicator: "unread-success" as const };
    const doneB = { ...b, indicator: "unread-success" as const };
    const { result, rerender, unmount } = renderHook(useArrivals, {
      initialProps: [a, b],
    });
    expect(result.current.size).toBe(0);
    rerender([doneA, b]);
    expect([...result.current]).toEqual(["a"]);
    act(() => vi.advanceTimersByTime(500));
    rerender([doneA, doneB]);
    rerender([{ ...doneA, isUnread: true }, doneB]);
    expect([...result.current].sort()).toEqual(["a", "b"]);
    act(() => vi.advanceTimersByTime(1000));
    expect([...result.current]).toEqual(["b"]);
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.size).toBe(0);

    // A later completion can animate again; pending timers are disposed.
    rerender([a, doneB]);
    rerender([doneA, doneB]);
    expect(result.current.has("a")).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let a previous completion's timer expire a newer one", () => {
    vi.useFakeTimers();
    const running = makeThread({ id: "a", indicator: "runtime" });
    const done = { ...running, indicator: "unread-success" as const };
    const { result, rerender } = renderHook(useArrivals, { initialProps: [running] });
    rerender([done]);
    act(() => vi.advanceTimersByTime(1000));
    rerender([running]);
    rerender([done]);
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.has("a")).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.size).toBe(0);
  });
});
