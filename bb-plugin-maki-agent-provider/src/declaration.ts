import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";

export function makiProviderDeclaration(): PluginProviderDeclaration {
  return {
    id: "maki",
    displayName: "maki",
    family: "acp",
    icon: "./icons/maki.svg",
    strings: {
      signInHint:
        "Run `maki` on the machine, pick a provider, and sign in — or set the provider's API key env var. See https://maki.sh/docs/providers.",
      expiredHint:
        "maki could not authenticate the last request. Sign in on the machine (`maki auth login`), then reload.",
      installUrl: "https://maki.sh",
    },
    experimental_visibility: "installed",
    experimental_bridgeOptions: {
      acpDialect: "generic",
      acpLaunchSpec: {
        displayName: "maki",
        command: "maki",
        args: ["acp"],
        env: {},
      },
    },
    models: { scope: "host" },
    maintenance: { health: true, usage: false, installation: true },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: "none",
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["low", "medium", "high"],
    },
    composerActions: [],
  };
}
