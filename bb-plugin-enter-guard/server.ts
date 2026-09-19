// bb-plugin-enter-guard — a BB plugin backend entry.
//
// The default export is a factory that receives the plugin API. All behavior
// lives in the frontend (app.tsx); this backend only declares the settings the
// UI reads via useSettings().
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Require double-Enter to send",
      description:
        "When on, a plain Enter in the prompt box flashes the border red and only sends if you press Enter again within the confirm window.",
      default: true,
    },
    windowMs: {
      type: "string",
      label: "Confirm window (ms)",
      description: "How long the second Enter is accepted after the first.",
      default: "1000",
    },
  });

  bb.log.info("loaded");
}
