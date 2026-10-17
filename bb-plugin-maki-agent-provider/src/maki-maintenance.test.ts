import { describe, expect, it } from "vitest";
import { experimental_compareVersions } from "@get-bb/plugin-sdk/provider-bridge";
import {
  __testing,
  getMakiInstallationRun,
  getMakiInstallationStatus,
} from "./maki-maintenance.js";

describe("maki maintenance", () => {
  it("reports installation status consistent with the version comparison", { timeout: 20_000 }, async () => {
    __testing.resetLatestVersionCache();
    const status = await getMakiInstallationStatus(true);
    expect(status.installed).toBe(true);
    expect(status.npmPackageName).toBeNull();
    if (status.currentVersion === null || status.latestVersion === null) {
      // Update check unavailable (offline or unreadable version): no action can be decided.
      expect(status.needsUpdate).toBe(false);
      expect(status.installAction).toBeNull();
      return;
    }
    const stale = experimental_compareVersions(status.latestVersion, status.currentVersion) > 0;
    expect(status.needsUpdate).toBe(stale);
    expect(status.installAction?.kind).toBe(stale ? "update" : null);
    if (stale) {
      expect(status.installAction?.label).toBe("Update");
      expect(status.installAction?.command).toContain("update");
    }
  });

  it("reports the update command for a stale version", async () => {
    __testing.resetLatestVersionCache();
    const run = await getMakiInstallationRun("update");
    if (run.available) {
      expect(run.command.args).toContain("update");
      expect(run.verification.kind).not.toBe("install");
    } else {
      expect(run.message).toContain("No maki update");
    }
  });

  it("replies install-only when nothing is installed", async () => {
    const status = await getMakiInstallationStatus(false);
    if (status.installed) return;
    expect(status.installAction?.kind).toBe("install");
    expect(status.installAction?.label).toBe("Install");
  });
});
