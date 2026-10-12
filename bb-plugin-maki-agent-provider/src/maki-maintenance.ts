import {
  experimental_compareVersions,
  experimental_formatCommand,
  experimental_installationVerification,
  experimental_readCliVersion,
  experimental_resolveExecutablePath,
  experimental_versionFrom,
} from "@get-bb/plugin-sdk/provider-bridge";
import type {
  ProviderInstallationActionKind,
  ProviderInstallationRunResult,
  ProviderInstallationStatus,
} from "@get-bb/plugin-sdk/provider-bridge";

const MAKI_COMMAND = "maki";
const GITHUB_LATEST_RELEASE_URL =
  "https://api.github.com/repos/tontinton/maki/releases/latest";
const GITHUB_TIMEOUT_MS = 15_000;
const LATEST_VERSION_TTL_MS = 10 * 60_000;

let latestVersionCache: {
  version: string | null;
  fetchedAt: number;
} | null = null;

function executableName(): string {
  return process.platform === "win32" ? "maki.exe" : "maki";
}

async function fetchLatestMakiVersion(): Promise<string | null> {
  const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "bb-plugin-maki-agent-provider",
    },
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GitHub releases responded with HTTP ${response.status}.`);
  }
  const body: unknown = await response.json();
  const tagName =
    typeof body === "object" && body !== null && "tag_name" in body
      ? (body as { tag_name?: unknown }).tag_name
      : null;
  return typeof tagName === "string" ? experimental_versionFrom(tagName) : null;
}

async function cachedLatestMakiVersion(): Promise<string | null> {
  const now = Date.now();
  if (
    latestVersionCache !== null &&
    now - latestVersionCache.fetchedAt < LATEST_VERSION_TTL_MS
  ) {
    return latestVersionCache.version;
  }
  try {
    const version = await fetchLatestMakiVersion();
    latestVersionCache = { version, fetchedAt: now };
    return version;
  } catch {
    // Keep any previous answer usable, but let the next check retry.
    if (latestVersionCache !== null) return latestVersionCache.version;
    return null;
  }
}

export function makiInstallScriptCommand(): {
  command: string;
  args: string[];
  displayCommand: string;
} {
  if (process.platform === "win32") {
    const display = "irm https://maki.sh/install.ps1 | iex";
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        display,
      ],
      displayCommand: display,
    };
  }
  const display = "curl -fsSL https://maki.sh/install.sh | sh";
  return {
    command: "sh",
    args: ["-c", display],
    displayCommand: display,
  };
}

function makiUpdateCommand(): {
  command: string;
  args: string[];
  displayCommand: string;
} {
  const args = ["update", "-y"];
  return {
    command: MAKI_COMMAND,
    args,
    displayCommand: experimental_formatCommand(MAKI_COMMAND, args),
  };
}

export async function getMakiInstallationStatus(
  checkUpdates: boolean,
): Promise<ProviderInstallationStatus> {
  const resolvedExecutable = await experimental_resolveExecutablePath(
    MAKI_COMMAND,
  );
  const currentVersion =
    resolvedExecutable === null
      ? null
      : await experimental_readCliVersion(MAKI_COMMAND);
  const latestVersion =
    checkUpdates && resolvedExecutable !== null
      ? await cachedLatestMakiVersion()
      : null;
  const installed = resolvedExecutable !== null;
  const needsUpdate =
    latestVersion !== null &&
    currentVersion !== null &&
    experimental_compareVersions(latestVersion, currentVersion) > 0;
  const actionKind: ProviderInstallationActionKind | null = !installed
    ? "install"
    : needsUpdate
      ? "update"
      : null;

  return {
    executableName: executableName(),
    executablePath: resolvedExecutable,
    installed,
    installSource: installed ? "external" : "notInstalled",
    currentVersion,
    latestVersion,
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction:
      actionKind === null
        ? null
        : {
            kind: actionKind,
            label: actionKind === "install" ? "Install" : "Update",
            command:
              actionKind === "install"
                ? makiInstallScriptCommand().displayCommand
                : makiUpdateCommand().displayCommand,
          },
    needsUpdate,
    versionUnsupported: false,
  };
}

export async function getMakiInstallationRun(
  action: ProviderInstallationActionKind,
): Promise<ProviderInstallationRunResult> {
  const status = await getMakiInstallationStatus(false);
  if (status.installAction?.kind !== action) {
    return {
      available: false,
      message:
        action === "install"
          ? "maki is already installed on this machine."
          : "No maki update is available on this machine.",
    };
  }
  return {
    available: true,
    command:
      action === "install" ? makiInstallScriptCommand() : makiUpdateCommand(),
    verification: experimental_installationVerification(status, action),
  };
}

export const __testing = {
  cachedLatestMakiVersion,
  makiInstallScriptCommand,
  makiUpdateCommand,
  resetLatestVersionCache: () => {
    latestVersionCache = null;
  },
};
