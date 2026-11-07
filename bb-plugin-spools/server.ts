// bb-plugin-spools — backend entry.
//
// The sidebar itself is frontend-only: thread state flows through the host's
// sidebar hooks and the public SDK. What the backend owns is the plugin's
// settings, which gate the more assertive visual behaviours so a user can
// turn down anything they find noisy without editing code.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  DEFAULT_SWIPE_LEFT,
  DEFAULT_SWIPE_RIGHT,
  SWIPE_ACTION_OPTION_LABELS,
} from "./lib/swipe";
import { buildSpoolsCli } from "./cli-spools";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
  bb.cli.register(buildSpoolsCli(bb));

  // Read in the frontend through useSettings(); every value has a default,
  // so the sidebar keeps working before the first load resolves.
  bb.settings.define({
    hoverCard: {
      type: "boolean",
      label: "Hover peek card",
      description:
        "When you pause on a thread, show a peek card carrying the same facts as the row's inline Details — no action buttons.",
      default: true,
    },
    celebrate: {
      type: "boolean",
      label: "Completion pop",
      description: "Pop the lead's check glyph once when a thread finishes.",
      default: true,
    },
    motion: {
      type: "boolean",
      label: "Attention motion",
      description:
        "Pulse the needs-you dot and spin the working glyph. Failed rows stay still. Turns off automatically under prefers-reduced-motion.",
      default: true,
    },
    loudUnread: {
      type: "boolean",
      label: "Loud unread rows",
      description:
        "Bold titles on finished-but-unseen threads. Off means no bold title, and the ink unread dot still shows.",
      default: true,
    },
    adaptiveCollapse: {
      type: "boolean",
      label: "Collapse quiet rows",
      description:
        "Fold read-idle threads down to title, project and time (no status pill, no pull request) so rows that matter stand out.",
      default: true,
    },
    defaultDensity: {
      type: "select",
      label: "Default row density",
      description:
        "Used until you pick a density in the header's View menu, which is remembered per client. Compact keeps the meta line, with tighter rows and single-line truncation.",
      options: ["comfortable", "compact"],
      default: "comfortable",
    },
    twoLineTitles: {
      type: "boolean",
      label: "Two-line titles",
      description:
        "Let long thread titles wrap onto a second line before truncating. Applies in both densities.",
      default: false,
    },
    swipeActions: {
      type: "boolean",
      label: "Swipe actions",
      description:
        "Swipe a thread left or right to act on it: one finger on a touch screen, two fingers on a trackpad. A mouse's clicks, drags and Shift+wheel are unaffected.",
      default: true,
    },
    swipeRight: {
      type: "select",
      label: "Swipe right",
      description: "What swiping a thread to the right does.",
      options: SWIPE_ACTION_OPTION_LABELS,
      default: DEFAULT_SWIPE_RIGHT,
    },
    swipeLeft: {
      type: "select",
      label: "Swipe left",
      description: "What swiping a thread to the left does.",
      options: SWIPE_ACTION_OPTION_LABELS,
      default: DEFAULT_SWIPE_LEFT,
    },
    activeDeck: {
      type: "boolean",
      label: "Active deck",
      description:
        "Pin an Active card to the top of the list, one per running thread, labelled with its spool or section. Each thread stays in its own section or spool too — these are glanceable duplicates. Only in Group By Section.",
      default: true,
    },
    addPosition: {
      type: "select",
      label: "Behavior when adding thread to spool",
      description:
        "Where a new arrival lands when a thread joins a spool — by drag-in, menu throw or palette throw. Members stay sorted oldest-first regardless.",
      options: ["bottom", "top"],
      experimental_optionLabels: {
        bottom: "Add to bottom of spool",
        top: "Add to top of spool",
      },
      default: "bottom",
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
