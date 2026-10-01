// Plugin health — pure logic for detecting the other BB plugins this plugin
// cooperates with. No BB handle, no I/O: server.ts feeds one fresh
// `bb.sdk.plugins.list()` result per call, so an install, enable, disable, or
// remove is reflected on the very next read and nothing here is cached.

/** The installed-plugin id of the Floating Notes plugin. */
export const FLOATING_NOTES_PLUGIN_ID = "floating-notes";

/** Where to send someone who still needs to install Floating Notes. */
export const FLOATING_NOTES_PLUGIN_URL =
  "https://github.com/vburojevic/bb-plugin-floating-notes";

/**
 * The fields of one `bb.sdk.plugins.list()` row the health computation
 * reads. Only the fields we use — the real InstalledPlugin carries many
 * more, and mirroring it here would make the whole list response a contract.
 */
export interface InstalledPluginSummary {
  id: string;
  enabled: boolean;
  status: string;
  version: string;
  /**
   * Where the install came from (e.g. `path:/…`, `git:https://…@semver:^1.0`,
   * `builtin:…`). Only read for this plugin's own row, to show the install
   * source on the settings page; optional so older/looser rows degrade.
   */
  source?: string;
}

/** One row of the Plugin health box on the settings page. */
export interface ToolHealth {
  id: string;
  label: string;
  installed: boolean;
  enabled: boolean;
  /** InstalledPlugin status when installed ("running", "disabled", …); null when not. */
  status: string | null;
  version: string | null;
  /** Set only when the tool is missing, so the UI can link to its plugin page. */
  installUrl: string | null;
  /** Installed, enabled, and not in a hard-failure status. */
  available: boolean;
}

export interface PluginHealthReport {
  /**
   * Whether Floating Notes is installed and enabled. The flag other parts
   * of this plugin gate Floating Notes cooperation on; identical to the
   * floating-notes row's `available`.
   */
  floatingNotesAvailable: boolean;
  tools: ToolHealth[];
  /**
   * Where this plugin's own install came from, so the settings page can
   * show a local in-progress checkout apart from a managed (official)
   * install. Never absent: an unknown self row just degrades to nulls.
   */
  self: SelfInstall;
}

/**
 * The install source of the Personas plugin itself, as the settings page's
 * source row renders it. `source` is the raw source string the host tracks
 * (`path:/home/…` for a local checkout, `git:…@semver:^1.0` for a managed
 * install, `builtin:…` for one that ships with BB); `managed` is the one-bit
 * answer to "official install or in-progress build?".
 */
export interface SelfInstall {
  version: string | null;
  source: string | null;
  /** False for path installs — the local, in-progress checkout case. */
  managed: boolean;
}

/** The settings-page label for one install source. */
export function selfInstallLabel(source: string): string {
  if (source.startsWith("path:")) {
    return `Local path install — ${source.slice("path:".length)}`;
  }
  if (source.startsWith("builtin:")) {
    return `Ships with BB (${source})`;
  }
  return source;
}

/**
 * Statuses an installed plugin can sit in that make it unusable even though
 * its row is present: disabled or missing (uninstalled, broken install),
 * error (its factory threw), and incompatible (its SDK major is wrong).
 * "running", "needs-configuration", and "degraded" all stay available —
 * the row's status text is shown in the UI for those nuances.
 */
const UNAVAILABLE_STATUSES = new Set([
  "disabled",
  "missing",
  "error",
  "incompatible",
]);

/**
 * True when a plugin row describes a usable plugin: present, enabled, and
 * not in a hard-failure status. Plugin rows are untrusted input, so an
 * unknown status counts as available rather than crashing the health read.
 */
function isAvailable(plugin: InstalledPluginSummary | undefined): boolean {
  return (
    plugin !== undefined &&
    plugin.enabled &&
    !UNAVAILABLE_STATUSES.has(plugin.status)
  );
}

function toToolHealth(
  input: {
    id: string;
    label: string;
    installUrl: string;
    plugin: InstalledPluginSummary | undefined;
  },
): ToolHealth {
  return {
    id: input.id,
    label: input.label,
    installed: input.plugin !== undefined,
    enabled: input.plugin?.enabled ?? false,
    status: input.plugin?.status ?? null,
    version: input.plugin?.version ?? null,
    installUrl: input.plugin === undefined ? input.installUrl : null,
    available: isAvailable(input.plugin),
  };
}

/**
 * Whether Floating Notes is available, for server-side callers that already
 * hold a plugins list. The single source of the `floatingNotesAvailable`
 * flag; pluginHealth below renders the same answer into the RPC output.
 */
export function isFloatingNotesAvailable(
  plugins: readonly InstalledPluginSummary[],
): boolean {
  return isAvailable(
    plugins.find((plugin) => plugin.id === FLOATING_NOTES_PLUGIN_ID),
  );
}

/**
 * The full health report the settings page shows: one row per cooperating
 * plugin, Floating Notes first; later entries just append. `selfId` is this
 * plugin's own installed id, used to pick the install-source row.
 */
export function pluginHealth(
  plugins: readonly InstalledPluginSummary[],
  selfId?: string,
): PluginHealthReport {
  const floatingNotes = toToolHealth({
    id: FLOATING_NOTES_PLUGIN_ID,
    label: "Floating Notes",
    installUrl: FLOATING_NOTES_PLUGIN_URL,
    plugin: plugins.find((plugin) => plugin.id === FLOATING_NOTES_PLUGIN_ID),
  });
  const self = plugins.find(
    (plugin) => selfId !== undefined && plugin.id === selfId,
  );
  return {
    floatingNotesAvailable: floatingNotes.available,
    tools: [floatingNotes],
    self: {
      version: self?.version ?? null,
      source: self?.source ?? null,
      // A path install is the local, in-progress checkout; everything else
      // (git, npm, builtin, catalog) is a managed install the host updates.
      managed: self?.source !== undefined && !self.source.startsWith("path:"),
    },
  };
}
