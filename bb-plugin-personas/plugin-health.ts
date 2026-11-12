// Plugin health — pure logic for detecting the other BB plugins this plugin
// cooperates with. No BB handle, no I/O: server.ts feeds one fresh
// `bb.sdk.plugins.list()` result per call, so an install, enable, disable, or
// remove is reflected on the very next read and nothing here is cached.

/** The installed-plugin id of the Floating Notes plugin. */
export const FLOATING_NOTES_PLUGIN_ID = "floating-notes";

/** Where to send someone who still needs to install Floating Notes. */
export const FLOATING_NOTES_PLUGIN_URL =
  "https://github.com/vburojevic/bb-plugin-floating-notes";

/** The installed-plugin id of the Thread Tags plugin. */
export const THREAD_TAGS_PLUGIN_ID = "thread-tags";

/**
 * The installed-plugin id of BB's built-in Docs plugin. Its package is
 * `bb-plugin-simple-notes` (display name "Docs"), so the id is
 * "simple-notes" whether it ships with BB (source `builtin:docs`) or is
 * installed standalone. Shown in the Plugin health box so a disabled Docs
 * explains why the Add-Docs-document affordance is gone.
 */
export const DOCS_PLUGIN_ID = "simple-notes";

/** Where to send someone who still needs to install Thread Tags. */
export const THREAD_TAGS_PLUGIN_URL =
  "https://github.com/VladPolet/bb-plugin-thread-tags";

/**
 * The source the one-click install RPC hands bb's own installer, pinned to
 * the same semver range the marketplace install of this plugin resolves to —
 * so the one-click result is the managed install the settings page already
 * describes, not a stray pin.
 */
export const THREAD_TAGS_PLUGIN_SOURCE =
  "git:https://github.com/VladPolet/bb-plugin-thread-tags.git@semver:^0.1.0";

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
  /**
   * Whether Thread Tags is installed and enabled, for the same gating as
   * the Floating Notes flag; identical to the thread-tags row's `available`.
   */
  threadTagsAvailable: boolean;
  /**
   * Whether the built-in Docs plugin is installed and enabled, the same
   * one-rule gate for the Docs-file prompt source; identical to the
   * simple-notes row's `available`.
   */
  docsAvailable: boolean;
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
 * Whether Thread Tags is available, for server-side callers that already
 * hold a plugins list and don't want the whole health report.
 */
export function isThreadTagsAvailable(
  plugins: readonly InstalledPluginSummary[],
): boolean {
  return isAvailable(
    plugins.find((plugin) => plugin.id === THREAD_TAGS_PLUGIN_ID),
  );
}

/**
 * Whether the built-in Docs plugin is available, for server-side callers
 * that already hold a plugins list. The single source of the
 * `docsAvailable` flag; pluginHealth below renders the same answer into the
 * RPC output.
 */
export function isDocsAvailable(
  plugins: readonly InstalledPluginSummary[],
): boolean {
  return isAvailable(
    plugins.find((plugin) => plugin.id === DOCS_PLUGIN_ID),
  );
}

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
    /** null = nowhere to send a missing install (BB's built-ins). */
    installUrl: string | null;
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
    // The link only ever shows while the tool is missing.
    installUrl: input.plugin === undefined ? (input.installUrl ?? null) : null,
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
  const threadTags = toToolHealth({
    id: THREAD_TAGS_PLUGIN_ID,
    label: "Thread Tags",
    installUrl: THREAD_TAGS_PLUGIN_URL,
    plugin: plugins.find((plugin) => plugin.id === THREAD_TAGS_PLUGIN_ID),
  });
  // Docs ships with BB, so there is nowhere to send a missing install — the
  // row's red X (or disabled readout) is all the guidance it needs.
  const docs = toToolHealth({
    id: DOCS_PLUGIN_ID,
    label: "Docs",
    installUrl: null,
    plugin: plugins.find((plugin) => plugin.id === DOCS_PLUGIN_ID),
  });
  const self = plugins.find(
    (plugin) => selfId !== undefined && plugin.id === selfId,
  );
  return {
    floatingNotesAvailable: floatingNotes.available,
    threadTagsAvailable: threadTags.available,
    docsAvailable: docs.available,
    tools: [floatingNotes, threadTags, docs],
    self: {
      version: self?.version ?? null,
      source: self?.source ?? null,
      // A path install is the local, in-progress checkout; everything else
      // (git, npm, builtin, catalog) is a managed install the host updates.
      managed: self?.source !== undefined && !self.source.startsWith("path:"),
    },
  };
}
