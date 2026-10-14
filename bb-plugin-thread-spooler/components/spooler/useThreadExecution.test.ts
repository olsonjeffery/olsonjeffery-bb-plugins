import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { useModelDisplayName, useThreadExecution, type ThreadExecution } from "./useThreadExecution";

// This hook only uses defaultExecutionOptions; keep the fake deliberately small.
function sdkWith(fetch: () => Promise<ThreadExecution>) {
  return { threads: { defaultExecutionOptions: fetch } } as unknown as PluginBrowserBbSdk;
}

afterEach(cleanup);

describe("catalog visibility", () => {
  it("defers catalog requests until visible, then reuses the provider cache", async () => {
    const fetch = vi.fn().mockResolvedValue({ models: [
      { id: "entry", model: "org/model", displayName: "Friendly model" },
    ] });
    const sdk = { providers: { models: fetch } } as unknown as PluginBrowserBbSdk;
    const hook = renderHook(({ visible }) =>
      useModelDisplayName("folded-provider", "org/model", sdk, visible),
      { initialProps: { visible: false } },
    );
    expect(hook.result.current).toBe("model");
    expect(fetch).not.toHaveBeenCalled();
    hook.rerender({ visible: true });
    await waitFor(() => expect(hook.result.current).toBe("Friendly model"));
    hook.rerender({ visible: false });
    hook.rerender({ visible: true });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("execution cache", () => {
  it("defers initial requests and hidden focus/activity changes until reveal", async () => {
    const execution = { model: "visible-model", reasoningLevel: "high" };
    const fetch = vi.fn().mockResolvedValue(execution);
    const sdk = sdkWith(fetch);
    const hook = renderHook(({ visible, epoch, activity }) =>
      useThreadExecution("initially-folded", sdk, epoch, true, activity, visible),
      { initialProps: { visible: false, epoch: 0, activity: 100 } },
    );
    expect(fetch).not.toHaveBeenCalled();
    hook.rerender({ visible: false, epoch: 1, activity: 200 });
    expect(fetch).not.toHaveBeenCalled();
    hook.rerender({ visible: true, epoch: 1, activity: 200 });
    await waitFor(() => expect(hook.result.current).toEqual(execution));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("preserves the same-run cache across folds but refreshes changes on reveal", async () => {
    const old = { model: "old", reasoningLevel: "low" };
    const next = { model: "new", reasoningLevel: "high" };
    const fetch = vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(next);
    const sdk = sdkWith(fetch);
    const hook = renderHook(({ visible, epoch, activity }) =>
      useThreadExecution("folded-cache", sdk, epoch, true, activity, visible),
      { initialProps: { visible: true, epoch: 0, activity: 100 } },
    );
    await waitFor(() => expect(hook.result.current).toEqual(old));
    hook.rerender({ visible: false, epoch: 0, activity: 100 });
    hook.rerender({ visible: true, epoch: 0, activity: 100 });
    expect(fetch).toHaveBeenCalledOnce();
    hook.rerender({ visible: false, epoch: 1, activity: 200 });
    expect(fetch).toHaveBeenCalledOnce();
    hook.rerender({ visible: true, epoch: 1, activity: 200 });
    await waitFor(() => expect(hook.result.current).toEqual(next));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("still ends a run's cache lifetime when it goes idle inside a fold", async () => {
    const old = { model: "old", reasoningLevel: "low" };
    const next = { model: "new", reasoningLevel: "high" };
    const fetch = vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(next);
    const sdk = sdkWith(fetch);
    const hook = renderHook(({ visible, enabled }) =>
      useThreadExecution("folded-restart", sdk, 0, enabled, 100, visible),
      { initialProps: { visible: true, enabled: true } },
    );
    await waitFor(() => expect(hook.result.current).toEqual(old));
    hook.rerender({ visible: false, enabled: false });
    expect(hook.result.current).toBeUndefined();
    hook.rerender({ visible: false, enabled: true });
    expect(fetch).toHaveBeenCalledOnce();
    hook.rerender({ visible: true, enabled: true });
    await waitFor(() => expect(hook.result.current).toEqual(next));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not publish an in-flight result to a row hidden before it resolves", async () => {
    let resolve!: (value: ThreadExecution) => void;
    const old = { model: "old", reasoningLevel: "low" };
    const next = { model: "new", reasoningLevel: "high" };
    const fetch = vi.fn()
      .mockReturnValueOnce(new Promise<ThreadExecution>((done) => { resolve = done; }))
      .mockResolvedValueOnce(next);
    const sdk = sdkWith(fetch);
    const hook = renderHook(({ visible, activity }) =>
      useThreadExecution("folded-pending", sdk, 0, true, activity, visible),
      { initialProps: { visible: true, activity: 100 } },
    );
    hook.rerender({ visible: false, activity: 200 });
    await act(async () => { resolve(old); });
    expect(hook.result.current).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
    hook.rerender({ visible: true, activity: 200 });
    await waitFor(() => expect(hook.result.current).toEqual(next));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes on a new run without refetching on same-run remounts", async () => {
    const old = { model: "old", reasoningLevel: "low" };
    const next = { model: "new", reasoningLevel: "high" };
    const fetch = vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(next);
    const sdk = sdkWith(fetch);
    const hook = ({ enabled }: { enabled: boolean }) =>
      useThreadExecution("restarted-run", sdk, 0, enabled);
    const first = renderHook(hook, { initialProps: { enabled: true } });
    await waitFor(() => expect(first.result.current).toEqual(old));
    first.unmount();

    const second = renderHook(hook, { initialProps: { enabled: true } });
    expect(second.result.current).toEqual(old);
    expect(fetch).toHaveBeenCalledTimes(1);
    second.rerender({ enabled: false });
    expect(second.result.current).toBeUndefined();
    second.rerender({ enabled: true });
    await waitFor(() => expect(second.result.current).toEqual(next));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes when a filtered-out row returns after newer activity", async () => {
    const old = { model: "old", reasoningLevel: "low" };
    const next = { model: "new", reasoningLevel: "high" };
    const fetch = vi.fn().mockResolvedValueOnce(old).mockResolvedValueOnce(next);
    const sdk = sdkWith(fetch);
    const first = renderHook(() =>
      useThreadExecution("filtered-run", sdk, 0, true, 100),
    );
    await waitFor(() => expect(first.result.current).toEqual(old));
    first.unmount();
    // The row never rendered enabled=false while the thread was idle.
    const second = renderHook(() =>
      useThreadExecution("filtered-run", sdk, 0, true, 200),
    );
    await waitFor(() => expect(second.result.current).toEqual(next));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["idle", "activity"])("discards stale pending requests across %s changes", async (change) => {
    let resolveOld!: (value: ThreadExecution) => void;
    const pending = new Promise<ThreadExecution>((resolve) => { resolveOld = resolve; });
    const next = { model: "new", reasoningLevel: "high" };
    const fetch = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(next);
    const sdk = sdkWith(fetch);
    const hook = ({ enabled, activity }: { enabled: boolean; activity: number }) =>
      useThreadExecution(`pending-run-${change}`, sdk, 0, enabled, activity);
    const first = renderHook(hook, { initialProps: { enabled: true, activity: 100 } });
    const activity = change === "activity" ? 200 : 100;
    if (change === "idle") first.rerender({ enabled: false, activity });
    first.rerender({ enabled: true, activity });
    await waitFor(() => expect(first.result.current).toEqual(next));
    await act(async () => {
      resolveOld({ model: "old", reasoningLevel: "low" });
      await pending;
    });
    first.unmount();
    const second = renderHook(hook, { initialProps: { enabled: true, activity } });
    expect(second.result.current).toEqual(next);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
