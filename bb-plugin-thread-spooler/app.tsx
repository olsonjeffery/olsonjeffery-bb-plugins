// bb-plugin-spooler-sidebar — a thread list you can read at a glance, for BB.
//
// Replaces the sidebar thread list (activity-grouped threads, nested families,
// loud attention states). Pick it under Settings → Appearance. Navigation
// belongs to BB's own rail since 0.46, which retired the navigation slot.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { migrateLegacyPreferences } from "./components/storage";
import { SpoolerThreadList } from "./components/spooler/SpoolerThreadList";
import "./app.css";

// Runs before any slot renders, so preferences read below the rename are
// already carried forward from the `codex-sidebar:` era.
migrateLegacyPreferences();

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "spooler",
    title: "Spooler",
    description:
      "Activity-grouped threads, nested families, and loud attention states.",
    component: SpoolerThreadList,
  });
});
