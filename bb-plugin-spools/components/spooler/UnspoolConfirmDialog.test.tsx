// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { UnspoolConfirmDialog } from "./UnspoolConfirmDialog";

afterEach(() => {
  cleanup();
});

function dialog(overrides: {
  title?: string;
  count?: number;
  onConfirm?(): void;
  onCancel?(): void;
} = {}) {
  return h(UnspoolConfirmDialog, {
    title: overrides.title ?? "Spool: Alpha",
    count: overrides.count ?? 3,
    onConfirm: overrides.onConfirm ?? vi.fn(),
    onCancel: overrides.onCancel ?? vi.fn(),
  });
}

describe("UnspoolConfirmDialog", () => {
  it("announces itself as an alert dialog and states the member count and title", () => {
    const { container } = render(dialog({ title: "Spool: Race", count: 2 }));
    // Renders into document.body via createPortal, outside the mount container.
    expect(container.contains(screen.getByRole("alertdialog"))).toBe(false);
    expect(document.body.contains(screen.getByRole("alertdialog"))).toBe(true);
    const alert = screen.getByRole("alertdialog");
    expect(alert.getAttribute("aria-modal")).toBe("true");
    expect(alert.textContent).toContain("Spool: Race");
    expect(alert.textContent).toContain("2");
    expect(alert.textContent).toContain("threads themselves are kept");
  });

  it("uses the singular when one member", () => {
    render(dialog({ count: 1 }));
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Unspool 1 thread",
    );
    expect(screen.getByRole("alertdialog").textContent).not.toContain(
      "1 threads",
    );
  });

  it("confirms on the danger button", () => {
    const onConfirm = vi.fn();
    const container = render(dialog({ onConfirm, count: 2 }));
    fireEvent.click(screen.getByText("Unspool 2 threads"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cancels via the cancel button and clicking the backdrop", () => {
    const onCancel = vi.fn();
    const first = render(dialog({ onCancel }));

    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();

    cleanup();
    // cleanup() removed the portal content from document.body.
    expect(document.querySelector(".spooler-confirm-backdrop")).toBeNull();
    const second = render(dialog({ onCancel }));
    fireEvent.mouseDown(document.querySelector(".spooler-confirm-backdrop")!);
    expect(onCancel).toHaveBeenCalledTimes(2);

    // Clicks inside the dialog itself do NOT cancel.
    fireEvent.mouseDown(screen.getByRole("alertdialog"));
    expect(onCancel).toHaveBeenCalledTimes(2);
    void first;
  });

  it("Enter confirms and Escape cancels; neither leaks as a window default", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(dialog({ onConfirm, onCancel }));

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("focuses the confirm button on open so keyboard users act deliberately", () => {
    render(dialog());
    expect(document.activeElement).toBe(screen.getByText("Unspool 3 threads"));
  });

  it("keydown handlers stop once unmounted", () => {
    const onConfirm = vi.fn();
    const { unmount } = render(dialog({ onConfirm }));
    unmount();
    act(() => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
