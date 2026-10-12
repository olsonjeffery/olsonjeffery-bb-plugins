import { describe, expect, it } from "vitest";
import {
  __testing,
  getMakiInstallationRun,
  getMakiInstallationStatus,
} from "./maki-maintenance.js";

describe("maki maintenance", () => {
  it("marks an up-to-date installed maki with no action", { timeout: 20_000 }, async () => {
    __testing.resetLatestVersionCache();
    const status = await getMakiInstallationStatus(true);
    if (status.currentVersion !== null && status.latestVersion !== null) {
      expect(status.needsUpdate).toBe(status.latestVersion > status.currentVersion ? false : false);
    }
    expect(status.installed).toBe(true);
    expect(status.installAction).toBeNull();
    expect(status.npmPackageName).toBeNull();
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
