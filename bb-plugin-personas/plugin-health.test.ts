// Pure policy tests for plugin-health.ts — which installed-plugin states
// count as available, when the install link appears, and how the install
// source row reads. The RPC-level path (one fresh plugins.list read per call)
// is covered in server.test.ts.
import { describe, expect, it } from "vitest";
import {
  DOCS_PLUGIN_ID,
  FLOATING_NOTES_PLUGIN_ID,
  FLOATING_NOTES_PLUGIN_URL,
  THREAD_TAGS_PLUGIN_ID,
  THREAD_TAGS_PLUGIN_SOURCE,
  THREAD_TAGS_PLUGIN_URL,
  isDocsAvailable,
  isFloatingNotesAvailable,
  isThreadTagsAvailable,
  pluginHealth,
  selfInstallLabel,
  type InstalledPluginSummary,
} from "./plugin-health.js";

function makePlugin(
  overrides: Partial<InstalledPluginSummary>,
): InstalledPluginSummary {
  return {
    id: FLOATING_NOTES_PLUGIN_ID,
    enabled: true,
    status: "running",
    version: "1.2.1",
    ...overrides,
  };
}

describe("isFloatingNotesAvailable", () => {
  it.each(["running", "needs-configuration", "degraded"] as const)(
    "is true when Floating Notes is installed, enabled, and %s",
    (status) => {
      expect(
        isFloatingNotesAvailable([makePlugin({ status })]),
      ).toBe(true);
    },
  );

  it.each(["disabled", "missing", "error", "incompatible"] as const)(
    "is false when Floating Notes is %s",
    (status) => {
      expect(
        isFloatingNotesAvailable([makePlugin({ status })]),
      ).toBe(false);
    },
  );

  it("is false when Floating Notes is not in the installed list at all", () => {
    expect(
      isFloatingNotesAvailable([
        { id: "personas", enabled: true, status: "running", version: "1.2.0" },
      ]),
    ).toBe(false);
  });

  it("is false for an enabled-but-disabled row (enabled flag wins over status text)", () => {
    expect(
      isFloatingNotesAvailable([makePlugin({ enabled: false, status: "running" })]),
    ).toBe(false);
  });
});

describe("isThreadTagsAvailable", () => {
  it.each(["running", "needs-configuration", "degraded"] as const)(
    "is true when Thread Tags is installed, enabled, and %s",
    (status) => {
      expect(
        isThreadTagsAvailable([
          makePlugin({ id: THREAD_TAGS_PLUGIN_ID, status }),
        ]),
      ).toBe(true);
    },
  );

  it.each(["disabled", "missing", "error", "incompatible"] as const)(
    "is false when Thread Tags is %s",
    (status) => {
      expect(
        isThreadTagsAvailable([
          makePlugin({ id: THREAD_TAGS_PLUGIN_ID, status }),
        ]),
      ).toBe(false);
    },
  );
});

describe("pluginHealth", () => {
  it("matches the floating-notes row's available flag", () => {
    expect(pluginHealth([makePlugin({})]).floatingNotesAvailable).toBe(true);
    expect(pluginHealth([makePlugin({ enabled: false })]).floatingNotesAvailable)
      .toBe(false);
  });

  it("appends the Thread Tags row after Floating Notes, and the Docs row after it", () => {
    const report = pluginHealth([
      makePlugin({}),
      makePlugin({ id: THREAD_TAGS_PLUGIN_ID, version: "0.1.0" }),
      makePlugin({ id: DOCS_PLUGIN_ID, version: "0.2.3" }),
    ]);
    expect(report.threadTagsAvailable).toBe(true);
    expect(report.docsAvailable).toBe(true);
    expect(report.tools).toHaveLength(3);
    expect(report.tools[1]).toMatchObject({
      id: THREAD_TAGS_PLUGIN_ID,
      label: "Thread Tags",
      installed: true,
      available: true,
      // No link once the plugin is present.
      installUrl: null,
    });
    expect(report.tools[2]).toMatchObject({
      id: DOCS_PLUGIN_ID,
      label: "Docs",
      installed: true,
      available: true,
    });
  });

  it("isDocsAvailable follows the same one-rule statuses", () => {
    expect(isDocsAvailable([makePlugin({ id: DOCS_PLUGIN_ID })])).toBe(true);
    expect(
      isDocsAvailable([makePlugin({ id: DOCS_PLUGIN_ID, status: "disabled" })]),
    ).toBe(false);
    expect(isDocsAvailable([])).toBe(false);
  });

  it("gives the built-in Docs row no install link even while missing", () => {
    const missing = pluginHealth([]).tools[2]!;
    expect(missing).toMatchObject({
      id: DOCS_PLUGIN_ID,
      label: "Docs",
      installed: false,
      available: false,
      installUrl: null,
    });
  });

  it("carries the plugin page link and the one-click source only while Thread Tags is missing", () => {
    const missing = pluginHealth([]).tools[1]!;
    expect(missing).toMatchObject({
      id: THREAD_TAGS_PLUGIN_ID,
      installed: false,
      installUrl: THREAD_TAGS_PLUGIN_URL,
      available: false,
    });
    expect(THREAD_TAGS_PLUGIN_SOURCE).toBe(
      "git:https://github.com/VladPolet/bb-plugin-thread-tags.git@semver:^0.1.0",
    );
  });

  it("reads Thread Tags as unavailable while disabled", () => {
    const report = pluginHealth([
      makePlugin({ id: THREAD_TAGS_PLUGIN_ID, enabled: false, status: "disabled" }),
    ]);
    expect(report.threadTagsAvailable).toBe(false);
    expect(report.tools[1]).toMatchObject({
      installed: true,
      enabled: false,
      installUrl: null,
    });
  });

  it("carries the plugin page link only while the tool is missing", () => {
    const missing = pluginHealth([]).tools[0]!;
    expect(missing.installUrl).toBe(FLOATING_NOTES_PLUGIN_URL);
    expect(missing.installed).toBe(false);

    const present = pluginHealth([makePlugin({})]).tools[0]!;
    expect(present.installUrl).toBeNull();
    expect(present.installed).toBe(true);
  });
});

describe("pluginHealth self install source", () => {
  it("reads the self row's source and version when passed a selfId", () => {
    const report = pluginHealth([
      makePlugin({ id: "personas", source: "path:/home/me/src/bb-plugin-personas" }),
    ], "personas");
    expect(report.self).toEqual({
      version: "1.2.1",
      source: "path:/home/me/src/bb-plugin-personas",
      managed: false,
    });
  });

  it("counts git, npm, and builtin sources as managed installs", () => {
    for (const source of [
      "git:https://github.com/olsonjeffery/bb-plugin-personas.git@semver:^1.0.0",
      "npm:bb-plugin-personas@1.0.0",
      "builtin:personas",
    ]) {
      const report = pluginHealth(
        [makePlugin({ id: "personas", source })],
        "personas",
      );
      expect(report.self.managed).toBe(true);
      expect(report.self.source).toBe(source);
    }
  });

  it("degrades to nulls when the self row is absent from the list", () => {
    const report = pluginHealth([makePlugin({})], "personas");
    expect(report.self).toEqual({
      version: null,
      source: null,
      managed: false,
    });
  });

  it("ignores another plugin's row even when selfId is omitted", () => {
    const report = pluginHealth([makePlugin({})]);
    expect(report.self.source).toBeNull();
  });
});

describe("selfInstallLabel", () => {
  it("marks a path install as the local in-progress checkout", () => {
    expect(selfInstallLabel("path:/home/me/src/bb-plugin-personas")).toBe(
      "Local path install — /home/me/src/bb-plugin-personas",
    );
  });

  it("names the builtin origin", () => {
    expect(selfInstallLabel("builtin:personas")).toBe(
      "Ships with BB (builtin:personas)",
    );
  });

  it("passes managed sources through verbatim", () => {
    expect(
      selfInstallLabel(
        "git:https://github.com/olsonjeffery/bb-plugin-personas.git@semver:^1.0.0",
      ),
    ).toBe(
      "git:https://github.com/olsonjeffery/bb-plugin-personas.git@semver:^1.0.0",
    );
  });
});
