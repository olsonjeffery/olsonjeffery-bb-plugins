import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

/**
 * The single destructive gate for unspooling. Enter confirms, Escape cancels;
 * the confirm button takes focus on open so keyboard users are one Enter away
 * from the dangerous action but must arrive at it deliberately.
 */
export function UnspoolConfirmDialog(props: {
  title: string;
  count: number;
  onConfirm(): void;
  onCancel(): void;
}): ReactNode {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        props.onConfirm();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        props.onCancel();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="spooler-confirm-backdrop" onMouseDown={props.onCancel}>
      <div
        className="spooler-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="spooler-confirm-title"
        aria-describedby="spooler-confirm-text"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="spooler-confirm-title" className="spooler-confirm-title">
          Unspool threads?
        </h2>
        <p id="spooler-confirm-text" className="spooler-confirm-text">
          Release all {props.count} thread{props.count === 1 ? "" : "s"} from{" "}
          <strong>{props.title}</strong>? The spool is removed and every member
          returns to its own section. The threads themselves are kept.
        </p>
        <div className="spooler-confirm-actions">
          <button
            type="button"
            className="spooler-confirm-cancel"
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="spooler-confirm-danger"
            onClick={props.onConfirm}
          >
            <Icon name="ListCollapse" aria-hidden="true" />
            Unspool {props.count} thread{props.count === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
