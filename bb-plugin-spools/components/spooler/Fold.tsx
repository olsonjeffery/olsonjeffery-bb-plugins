// The shared collapse animation, lifted out of SpoolerThreadList so the
// Active deck can fold like the ordinary sections do.
import { useEffect, useState, type ReactNode } from "react";

/** Outlasts the `.spooler-fold` collapse transition (280ms in app.css). */
export const FOLD_UNMOUNT_MS = 320;

/**
 * A collapsible body. Its content stays mounted only while open and through
 * the closing animation, so a folded group costs nothing: no rows, no
 * per-row host subscriptions, no pull-request lookups. Opening mounts the
 * content in the same commit the grid starts growing, so it animates.
 */
export function Fold({
  collapsed,
  role,
  label,
  children,
}: {
  collapsed: boolean;
  role: "list" | "group";
  label: string;
  children: () => ReactNode;
}) {
  const [closed, setClosed] = useState(collapsed);
  useEffect(() => {
    if (!collapsed) {
      setClosed(false);
      return;
    }
    const timer = setTimeout(() => setClosed(true), FOLD_UNMOUNT_MS);
    return () => clearTimeout(timer);
  }, [collapsed]);
  return (
    <div
      className={`spooler-fold${collapsed ? " spooler-fold-collapsed" : ""}`}
      aria-hidden={collapsed || undefined}
      inert={collapsed || undefined}
    >
      <div className="spooler-fold-inner" role={role} aria-label={label}>
        {collapsed && closed ? null : children()}
      </div>
    </div>
  );
}
