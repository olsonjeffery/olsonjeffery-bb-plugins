// bb-plugin-spools — a thread list you can read at a glance, for BB.
//
// Replaces the sidebar thread list (activity-grouped threads, nested families,
// loud attention states). Pick it under Settings → Appearance. Navigation
// belongs to BB's own rail since 0.46, which retired the navigation slot.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { migrateLegacyPreferences } from "./components/storage";
import { SpoolerThreadList } from "./components/spooler/SpoolerThreadList";
import { requestPaletteIntent } from "./components/spooler/paletteBus";
import { SpoolsSettingsSection } from "./components/spooler/SettingsSections";
import "./app.css";

// Runs before any slot renders, so preferences read below the rename are
// already carried forward from the `codex-sidebar:` era.
migrateLegacyPreferences();

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "spooler",
    title: "Spools",
    description:
      "Activity-grouped threads, nested families, and loud attention states.",
    component: SpoolerThreadList,
  });

  // The palette commands run in the same bundle as the sidebar thread list:
  // they hand their intent to SpoolerThreadList over a window event and the
  // sidebar shows the picker overlay (no thread-panel slot involved).

  app.slots.settingsSection({
    id: "sections-and-spools",
    title: "Sections & spools",
    description: "Edit your sections; inspect and unravel spools.",
    component: SpoolsSettingsSection,
  });

  app.commands.register({
    id: "move-to-section",
    title: "Spools: move thread to section…",
    isAvailable: (context) => context.threadId !== null,
    run: (context) =>
      requestPaletteIntent({ kind: "move-to-section", threadId: context.threadId! }),
  });
  app.commands.register({
    id: "throw-onto-spool",
    title: "Spools: throw thread onto spool…",
    isAvailable: (context) => context.threadId !== null,
    run: (context) =>
      requestPaletteIntent({ kind: "throw-onto-spool", threadId: context.threadId! }),
  });
});
