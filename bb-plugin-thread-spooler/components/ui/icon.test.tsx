import { cleanup, render } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Icon, preloadExtendedIcons } from "./icon";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useSyncExternalStore: vi.fn(actual.useSyncExternalStore) };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("static Spooler icons", () => {
  it("renders core icons without external-store subscriptions", () => {
    const slot = render(<Icon name="Search" className="search-icon" aria-label="Search threads" />);
    const icon = slot.container.querySelector("svg")!;
    expect(icon.getAttribute("data-icon")).toBe("Search");
    expect(icon.classList.contains("search-icon")).toBe(true);
    expect(icon.getAttribute("aria-label")).toBe("Search threads");
    expect(useSyncExternalStore).not.toHaveBeenCalled();
  });

  it("retains the extended-icon loader subscription, but no override subscriptions", async () => {
    await preloadExtendedIcons();
    const slot = render(<Icon name="Pin" aria-hidden="true" />);
    const icon = slot.container.querySelector("svg")!;
    expect(icon.getAttribute("data-icon")).toBe("Pin");
    expect(icon.getAttribute("data-icon-pending")).toBeNull();
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(useSyncExternalStore).toHaveBeenCalledOnce();
  });

  it.each([
    ["not-an-icon", undefined, "Zap"],
    ["not-an-icon", "Search", "Search"],
    ["not-an-icon", "also-unknown", "Zap"],
    ["Search", "also-unknown", "Search"],
    ["constructor", undefined, "Zap"],
  ])("preserves fallback resolution for %s / %s", (name, fallback, resolved) => {
    const slot = render(<Icon name={name} fallback={fallback} />);
    expect(slot.container.querySelector("svg")?.getAttribute("data-icon")).toBe(resolved);
    expect(useSyncExternalStore).not.toHaveBeenCalled();
  });
});
