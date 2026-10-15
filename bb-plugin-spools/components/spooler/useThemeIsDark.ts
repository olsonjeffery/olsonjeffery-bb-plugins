import { useSyncExternalStore } from "react";

/**
 * Whether the host sidebar is currently drawing its dark theme.
 *
 * The plugin has no theme API to ask (AppTheme is just `{themeId}`), so this
 * probes the host's own resolved tokens: a one-off probe element styled with
 * `var(--background)` inherits whatever palette the host CSS defines, and the
 * resolved background's luminance decides. Re-probes whenever the host flips
 * its root element's class or style (how themes are swapped in practice).
 */

const LIGHT_LUMINANCE_THRESHOLD = 0.45;

function parseRgb(color: string): [number, number, number, number] | null {
  const match = color.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?\s*\)/,
  );
  if (!match) return null;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  let a = 1;
  if (match[4] != null) {
    a = match[4].endsWith("%")
      ? Number(match[4].slice(0, -1)) / 100
      : Number(match[4]);
  }
  return [r, g, b, a];
}

export function isDarkColor(color: string): boolean {
  const parsed = parseRgb(color);
  // Unresolvable (tokens not mounted yet, unsupported color function): stay
  // light — a wrong dark guess would paint white-looking text over pastels.
  if (!parsed || parsed[3] < 0.5) return false;
  const [r, g, b] = parsed;
  // WCAG relative luminance on sRGB channels.
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.04045
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance < LIGHT_LUMINANCE_THRESHOLD;
}

/** Subscribe-side store: re-probes only when the host root's theme-relevant
 *  attributes change (getSnapshot must be cheap; a probe forces style
 *  resolution, so results are cached behind a version counter). */
let cachedDark = false;
let snapshotVersion = 0;

function probeIsDark(): boolean {
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.display = "none";
  probe.style.background = "var(--background, rgb(255 255 255))";
  document.documentElement.appendChild(probe);
  const resolved = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return isDarkColor(resolved);
}

function subscribe(onStoreChange: () => void): () => void {
  const observer = new MutationObserver(() => {
    snapshotVersion += 1;
    cachedDark = probeIsDark();
    onStoreChange();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme", "color-scheme"],
  });
  return () => observer.disconnect();
}

function getDarkSnapshot(): boolean {
  if (seenVersion !== snapshotVersion) {
    seenVersion = snapshotVersion;
    cachedDark = probeIsDark();
  }
  return cachedDark;
}

let seenVersion = -1;

function getLightSnapshot(): boolean {
  return false;
}

export function useThemeIsDark(): boolean {
  // useSyncExternalStore so many colored sections share one probe and every
  // re-render after a theme flip paints the correct variant at once.
  return useSyncExternalStore(
    subscribe,
    getDarkSnapshot,
    // getServerSnapshot: colors resolve on the client after mount anyway.
    getLightSnapshot,
  );
}
