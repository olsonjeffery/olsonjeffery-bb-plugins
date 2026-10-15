import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export type SpoolerMenuItem =
  | {
      kind: "item";
      id: string;
      label: string;
      icon?: string;
      /** CSS color; renders a filled dot instead of an icon (color pickers). */
      swatch?: string;
      checked?: boolean;
      danger?: boolean;
      disabled?: boolean;
    }
  | { kind: "separator" }
  | { kind: "header"; label: string };

/**
 * A small viewport-fixed context menu. Rendered with `position: fixed` from
 * client coordinates, clamped into the window. It closes on outside
 * pointer-down, Escape, scroll, or resize, and every listener is removed on
 * unmount.
 */
export function SpoolerMenu({
  x,
  y,
  items,
  onSelect,
  onClose,
}: {
  x: number;
  y: number;
  items: SpoolerMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const width = 248;
  const estimatedHeight = Math.min(items.length * 32 + 16, 420);
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - estimatedHeight - 8));

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = (event: Event) => {
      if (ref.current && ref.current.contains(event.target as Node)) return;
      onClose();
    };
    const onResize = () => onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const moveFocus = (direction: 1 | -1 | "first" | "last") => {
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-menu-item]:not(:disabled)',
      ) ?? [],
    );
    if (buttons.length === 0) return;
    if (direction === "first" || direction === "last") {
      buttons[direction === "first" ? 0 : buttons.length - 1]?.focus();
      return;
    }
    const active = document.activeElement;
    const index = buttons.findIndex((button) => button === active);
    const next =
      index === -1
        ? direction === 1
          ? 0
          : buttons.length - 1
        : (index + direction + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label="Thread actions"
      className="spooler-menu"
      style={{ left, top, width }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveFocus(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          moveFocus(-1);
        } else if (event.key === "Home") {
          event.preventDefault();
          moveFocus("first");
        } else if (event.key === "End") {
          event.preventDefault();
          moveFocus("last");
        }
      }}
    >
      {items.map((item, index) => {
        if (item.kind === "separator") {
          return (
            // eslint-disable-next-line react/no-array-index-key
            <div key={`sep-${index}`} role="separator" className="spooler-menu-separator" />
          );
        }
        if (item.kind === "header") {
          return (
            // eslint-disable-next-line react/no-array-index-key
            <div key={`head-${index}`} className="spooler-menu-header">
              {item.label}
            </div>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            data-menu-item=""
            disabled={item.disabled}
            className={cn(
              "spooler-menu-item",
              item.danger && "spooler-menu-item-danger",
            )}
            onClick={() => onSelect(item.id)}
          >
            {item.swatch ? (
              <span
                className="spooler-menu-icon spooler-menu-swatch"
                style={{ background: item.swatch }}
                aria-hidden="true"
              />
            ) : item.icon === "🧵" ? (
              <span
                className="spooler-menu-icon spooler-spool-emoji"
                aria-hidden="true"
              >
                🧵
              </span>
            ) : item.icon ? (
              <Icon name={item.icon} aria-hidden="true" className="spooler-menu-icon" />
            ) : (
              <span className="spooler-menu-icon" aria-hidden="true" />
            )}
            <span className="spooler-menu-label">{item.label}</span>
            {item.checked ? (
              <Icon name="Check" aria-hidden="true" className="spooler-menu-check" />
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
