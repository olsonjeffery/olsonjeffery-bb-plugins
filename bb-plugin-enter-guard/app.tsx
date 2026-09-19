// bb-plugin-enter-guard — a BB plugin frontend entry.
//
// Intercepts plain Enter in the prompt box: the first press flashes a glowing
// red border and does NOT send; a second press within the confirm window
// (default 1000ms) sends the message. Typeahead selection, newline Enters, and
// sends with a disabled submit button are left alone.
import { useEffect } from "react";
import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";
import { guardConfig, parseWindowMs } from "./guard-config";
import "./app.css";

const PROMPTBOX_SELECTOR = "[data-promptbox]";
const EDITOR_REGION_SELECTOR = "[data-promptbox-editor-content]";
const SUBMIT_ACTION_SELECTOR = "[data-promptbox-submit-action]";
const TYPEAHEAD_MENU_SELECTOR = ".bg-popover";
const GLOW_CLASS = "enter-guard-glow";
const GLOW_DURATION_VAR = "--enter-guard-flash-ms";

// A content script is plain DOM code with no React hooks, so the current
// settings reach it through the shared guardConfig module, written by the
// GuardConfigBridge banner mounted in every composer below.
function isPlainSubmitEnter(event: KeyboardEvent): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}

// Keeps the current settings in guardConfig so the content script can read
// them without any React hooks. Renders nothing.
function GuardConfigBridge() {
  const { values, isLoading } = useSettings();

  useEffect(() => {
    if (isLoading || values === undefined) return;
    guardConfig.enabled = values.enabled !== false;
    guardConfig.windowMs = parseWindowMs(values.windowMs);
  }, [values, isLoading]);

  return null;
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "enter-guard",
    mount({ signal }) {
      let armedAt: number | null = null;
      let armedBox: HTMLElement | null = null;
      let armTimer: ReturnType<typeof setTimeout> | null = null;

      const disarm = () => {
        if (armTimer !== null) {
          clearTimeout(armTimer);
          armTimer = null;
        }
        armedAt = null;
        if (armedBox !== null) {
          armedBox.classList.remove(GLOW_CLASS);
          armedBox.style.removeProperty(GLOW_DURATION_VAR);
          armedBox = null;
        }
      };

      const onKeyDown = (event: KeyboardEvent) => {
        if (!guardConfig.enabled) return;
        if (!isPlainSubmitEnter(event)) return;

        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const editorRegion = target.closest<HTMLElement>(EDITOR_REGION_SELECTOR);
        if (editorRegion === null) return;

        const box = target.closest<HTMLElement>(PROMPTBOX_SELECTOR);
        if (box === null) return;

        // Enter selects a mention/command suggestion here — not a send.
        if (box.querySelector(TYPEAHEAD_MENU_SELECTOR) !== null) return;

        // Zen mode turns plain Enter into a newline.
        if (box.hasAttribute("data-promptbox-zen")) return;

        // On coarse-pointer devices plain Enter inserts a newline, not a send.
        if (window.matchMedia("(pointer: coarse)").matches) return;

        // A disabled submit button means Enter would not send; don't gate it.
        const submitButton = box.querySelector<HTMLButtonElement>(
          SUBMIT_ACTION_SELECTOR,
        );
        if (submitButton !== null && submitButton.disabled) return;

        const now = performance.now();
        if (
          armedAt !== null &&
          armedBox === box &&
          now - armedAt <= guardConfig.windowMs
        ) {
          // Confirmed: let this Enter through to actually send.
          disarm();
          return;
        }

        // First press (or the previous confirm window lapsed): block and flash.
        event.preventDefault();
        event.stopPropagation();
        disarm();
        armedAt = now;
        armedBox = box;
        box.classList.add(GLOW_CLASS);
        box.style.setProperty(GLOW_DURATION_VAR, `${guardConfig.windowMs}ms`);
        armTimer = setTimeout(disarm, guardConfig.windowMs);
      };

      document.addEventListener("keydown", onKeyDown, {
        capture: true,
        signal,
      });
      signal.addEventListener("abort", disarm, { once: true });

      return disarm;
    },
  });

  app.composer.customize({
    id: "enter-guard-config",
    banners: [
      {
        id: "config-bridge",
        chrome: "bare",
        component: GuardConfigBridge,
      },
    ],
  });
});
