// Data plumbing for every Draft Stack surface: one RPC client, one realtime
// refresh, and the app-wide icon accent (bb's "icon color" appearance
// setting) the popup's selection halo tints itself with.
import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { rpcContract, StackEntry } from "@/server";

export type { StackEntry };

export function useDraftStackRpc() {
  return useRpc<typeof rpcContract>();
}

export type DraftStackRpc = ReturnType<typeof useDraftStackRpc>;

/** Realtime channel the server publishes after every stack write. */
const CHANNEL = "draft-stack-changed";

/**
 * The whole stack, array order (index 0 = bottom, last = top), refreshed on
 * the server's "draft-stack-changed" signal so every open surface (popup,
 * settings in another window, a CLI write) stays live.
 */
export function useDraftStack() {
  const rpc = useDraftStackRpc();
  const [stack, setStack] = useState<StackEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    rpc.call("listStack", null).then(
      (result) => {
        setStack(result.stack);
        setError(null);
      },
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  }, [rpc]);

  useEffect(() => {
    reload();
  }, [reload]);
  useRealtime(CHANNEL, reload);

  return { rpc, stack, error, reload };
}

/** bb's Appearance → "Icon color" preference, as a CSS color. */
const ICON_COLOR_HEX: Record<string, string> = {
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#ffba18",
  green: "#30a46c",
  teal: "#12a594",
  blue: "#0090ff",
  purple: "#8e4ec6",
  pink: "#d6409f",
};
const ICON_COLOR_FALLBACK = "var(--accent)";
const CACHED_ICON_COLOR_KEY = "bb.faviconColor";

/**
 * The halo color for the stack selector's highlighted row: the same color the
 * user picked for bb's icon (this instance picks pink). Reads the cached
 * localStorage preference first so the first paint is right, then refines
 * from the server's system config (the synced source of truth). "default"
 * falls back to the theme accent.
 */
export function useIconAccent(): string {
  const sdk = useSdk();
  const [color, setColor] = useState<string>(() => {
    try {
      const cached = localStorage.getItem(CACHED_ICON_COLOR_KEY);
      if (cached !== null && cached in ICON_COLOR_HEX) return ICON_COLOR_HEX[cached]!;
    } catch {
      // localStorage unavailable (privacy mode): fall through to the default.
    }
    return ICON_COLOR_FALLBACK;
  });

  useEffect(() => {
    let cancelled = false;
    sdk
      .system.config()
      .then((config) => {
        if (cancelled) return;
        const preference = config.appearance.faviconColor;
        setColor(ICON_COLOR_HEX[preference] ?? ICON_COLOR_FALLBACK);
      })
      .catch(() => {
        // Keep the cached guess; the halo still renders.
      });
    return () => {
      cancelled = true;
    };
  }, [sdk]);

  return color;
}
