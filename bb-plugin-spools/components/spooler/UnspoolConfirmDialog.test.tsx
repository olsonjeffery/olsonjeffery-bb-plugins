// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
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
    const container = render(dialog({ title: "Spool: Race", count: 2 }));
    const alert = container.getByRole("alertdialog");
    expect(alert.getAttribute("aria-modal")).toBe("true");
    expect(alert.textContent).toContain("Spool: Race");
    expect(alert.textContent).toContain("2");
    expect(alert.textContent).toContain("threads themselves are kept");
  });

  it("uses the singular when one member", () => {
    const container = render(dialog({ count: 1 }));
    expect(container.getByRole("alertdialog").textContent).toContain(
      "Unspool 1 thread",
    );
    expect(container.getByRole("alertdialog").textContent).not.toContain(
      "1 threads",
    );
  });

  it("confirms on the danger button", () => {
    const onConfirm = vi.fn();
    const container = render(dialog({ onConfirm, count: 2 }));
    fireEvent.click(container.getByText("Unspool 2 threads"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("cancels via the cancel button and clicking the backdrop", () => {
    const onCancel = vi.fn();
    const first = render(dialog({ onCancel }));

    fireEvent.click(first.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();

    cleanup();
    const second = render(dialog({ onCancel }));
    fireEvent.mouseDown(second.container.querySelector(".spooler-confirm-backdrop")!);
    expect(onCancel).toHaveBeenCalledTimes(2);

    // Clicks inside the dialog itself do NOT cancel.
    fireEvent.mouseDown(second.getByRole("alertdialog"));
    expect(onCancel).toHaveBeenCalledTimes(2);
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
    const container = render(dialog());
    expect(document.activeElement).toBe(container.getByText("Unspool 3 threads"));
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
