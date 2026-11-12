// bb-plugin-drawio — backend entry.
//
// Owns the settings, the needs-configuration posture, the two persistence
// adapters (Docs-vault via cross-plugin RPC, workspace via bb.sdk.files), the
// .drawio discovery cache, draft storage, and the RPC contract the frontend
// drives. The plugin reports needs-configuration until a draw.io instance URL
// is set; everything except the embedded editor already works before that.
import {
  experimental_PluginRpcRefusal,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  REALTIME_CHANNEL,
  rpcContract,
  type FileSourceJson,
  type VaultFileEntry,
} from "./contract.js";
import { MIGRATIONS, Store } from "./drafts.js";
import { VaultAdapter } from "./vault.js";
import { WorkspaceAdapter } from "./workspace.js";

const SETTINGS_SCHEMA_MAX_URL = 2000;
/** How long a vault's discovery cache serves reads before re-snapshotting. */
const VAULT_CACHE_TTL_MS = 120_000;

// The URL/folder schemas run on the server for settings-page autosaves,
// `bb plugin config`, and `experimental_set`; keep them synchronous and
// non-transforming.
const zUrl = z
  .string()
  .max(SETTINGS_SCHEMA_MAX_URL, "Instance URL is too long")
  .refine((value) => {
    const trimmed = value.trim();
    if (trimmed === "") return true; // unset on purpose
    try {
      const url = new URL(trimmed);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Must be an http(s) URL, e.g. http://localhost:8080");

const zFolder = z
  .string()
  .max(300)
  .refine((value) => {
    const clean = value.trim().replace(/^\/+|\/+$/g, "");
    if (clean === "") return true;
    return clean
      .split("/")
      .every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && !segment.startsWith("."));
  }, "Folders are relative paths like `diagrams` (no `..`, no dot-prefixed segments)");

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const store = new Store(db);

  const settings = bb.settings.define({
    instanceUrl: {
      type: "string",
      label: "draw.io instance URL",
      description:
        "Base URL of your self-hosted draw.io webapp (e.g. http://localhost:8080). " +
        "The official jgraph/drawio Docker image works as-is.",
      default: "",
      experimental_schema: zUrl,
    },
    defaultVaultId: {
      type: "string",
      label: "Default vault",
      description: "Vault that new diagrams are created in (default: the first vault).",
      default: "",
    },
    defaultFolder: {
      type: "string",
      label: "Vault folder",
      description: "Folder inside the vault where new diagrams land.",
      default: "diagrams",
      experimental_schema: zFolder,
    },
    uiTheme: {
      type: "select",
      label: "Editor UI theme",
      options: ["min", "sketch", "atlas"],
      experimental_optionLabels: {
        min: "Minimal (classic toolbars)",
        sketch: "Sketch (hand-drawn style)",
        atlas: "Atlas",
      },
      default: "min",
    },
  });

  const vault = new VaultAdapter({
    listPlugins: async () => (await bb.sdk.plugins.list()).plugins,
    callDocsRpc: (method, input, outputSchema) =>
      bb.sdk.plugins.callRpc({
        pluginId: "simple-notes",
        method,
        input: input as import("@get-bb/plugin-sdk").JsonValue,
        outputSchema,
      }),
    log: bb.log,
  });
  const workspace = new WorkspaceAdapter(bb);

  // Unconfigured plugins still load: drafts, the workspace fileOpener, and the
  // vault cache all work; only the embedded editor waits for an instance.
  const initial = await settings.get();
  if (!initial.instanceUrl.trim()) {
    bb.status.needsConfiguration(
      "Set the draw.io instance URL under Settings → Plugins → Drawio, or with `bb plugin config drawio set instanceUrl <url>`.",
    );
  }

  const publish = (payload: Record<string, unknown>) => {
    bb.realtime.publish(REALTIME_CHANNEL, payload);
  };

  const readEffective = async () => {
    const values = await settings.get();
    const instanceUrl = values.instanceUrl.trim().replace(/\/+$/, "");
    return {
      configured: instanceUrl !== "",
      instanceUrl,
      defaultVaultId: values.defaultVaultId.trim(),
      defaultFolder: normalizeFolder(values.defaultFolder),
      uiTheme: values.uiTheme as "min" | "sketch" | "atlas",
    };
  };

  /**
   * Full snapshot → cache rows for EVERY vault file (content is dropped): the
   * browser is a complete Docs-vault browser, not a drawio-only one. bb's own
   * Docs browser lists Markdown/HTML only, so this is where all file types
   * stay visible.
   */
  async function refreshVaultCache(vaultId: string, now: number): Promise<VaultFileEntry[]> {
    const { files } = await vault.snapshot(vaultId, { kind: "all" });
    const entries: VaultFileEntry[] = files
      .map((file) => ({
        path: file.remotePath,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
        modifiedAtMs: file.modifiedAtMs ?? 0,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
    store.syncVault(vaultId, entries, now);
    return entries;
  }
  // The docs plugin itself rejects unknown vault ids with the same message, so
  // vault handlers pass ids straight through instead of pre-validating them.

  function noteVaultWrite(
    vaultId: string,
    path: string,
    sha256: string,
    sizeBytes: number,
  ): void {
    store.noteVaultWrite(vaultId, path, sha256, sizeBytes, Date.now());
    publish({ reason: "vault-files", vaultId });
  }

  bb.rpc.register(rpcContract, {
    "config.status": async () => {
      const values = await readEffective();
      const docs = await vault.availability();
      return { ...values, docsAvailable: docs.available };
    },

    "vault.list": async () => {
      const docs = await vault.availability();
      if (!docs.available) return { vaults: [] };
      return { vaults: await vault.listVaults() };
    },

    "vault.files": async ({ vaultId, refresh }) => {
      const now = Date.now();
      const syncedAt = store.vaultSyncedAt(vaultId);
      // TTL auto-refresh: files created outside this plugin (agents, bb docs)
      // appear within two minutes without anyone pressing refresh.
      const expired = syncedAt === null || now - syncedAt > VAULT_CACHE_TTL_MS;
      if (refresh || expired) {
        const files = await refreshVaultCache(vaultId, now);
        return { files, refreshedAtMs: now, stale: false };
      }
      return { files: store.vaultFiles(vaultId), refreshedAtMs: syncedAt, stale: false };
    },

    "vault.read": async ({ vaultId, path }) => {
      let file: Awaited<ReturnType<typeof vault.read>>;
      try {
        file = await vault.read(vaultId, path);
      } catch (cause) {
        if (isMissingVaultFile(cause)) {
          // A stale deep link (or a file an agent deleted) must not linger in
          // the discovery cache either — self-heal it here.
          store.noteVaultRemove(vaultId, path);
          publish({ reason: "vault-files", vaultId });
          throw new experimental_PluginRpcRefusal({
            code: "not_found",
            message: `This diagram does not exist in the vault: ${path}`,
          });
        }
        throw cause;
      }
      if (file.contentEncoding !== "utf8") {
        throw new Error("This file is not UTF-8 text; the editor cannot open it");
      }
      return { content: file.content, sha256: file.sha256, modifiedAtMs: file.modifiedAtMs ?? null };
    },

    "vault.write": async ({ vaultId, path, content, expectedSha256 }) => {
      const result = await vault.write(vaultId, path, content, expectedSha256);
      if (result.outcome === "conflict") {
        return { outcome: "conflict" as const, currentSha256: result.currentSha256 ?? null };
      }
      noteVaultWrite(vaultId, path, result.sha256, result.sizeBytes ?? 0);
      return { outcome: "written" as const, sha256: result.sha256 };
    },

    "vault.create": async ({ vaultId, path, content }) => {
      // Create-only: refuses to overwrite an existing diagram.
      const result = await vault.write(vaultId, path, content, null);
      if (result.outcome === "conflict") {
        return { outcome: "conflict" as const, currentSha256: result.currentSha256 ?? null };
      }
      noteVaultWrite(vaultId, path, result.sha256, result.sizeBytes ?? 0);
      return { outcome: "written" as const, sha256: result.sha256 };
    },

    "vault.move": async ({ vaultId, from, to }) => {
      const path = await vault.move(vaultId, from, to);
      store.noteVaultMove(vaultId, from, to, Date.now());
      publish({ reason: "vault-files", vaultId });
      return { path };
    },

    "vault.delete": async ({ vaultId, path, recursive }) => {
      await vault.remove(vaultId, path, recursive === true);
      store.noteVaultRemove(vaultId, path);
      store.discardDraft(`vault:${vaultId}:${path}`);
      publish({ reason: "vault-files", vaultId });
      return { ok: true } as const;
    },

    "vault.createFolder": async ({ vaultId, path }) => {
      return { path: await vault.createFolder(vaultId, path) };
    },

    "workspace.read": async ({ source, path }) => {
      const file = await workspace.read(source as FileSourceJson, path);
      return file;
    },

    "workspace.write": async ({ source, path, content, expectedSha256 }) => {
      const result = await workspace.write(
        source as FileSourceJson,
        path,
        content,
        expectedSha256,
      );
      if (result.outcome === "conflict") {
        return { outcome: "conflict" as const, currentSha256: result.currentSha256 };
      }
      return { outcome: "written" as const, sha256: result.sha256 };
    },

    "drafts.get": async ({ key }) => {
      const row = store.getDraft(key);
      return {
        draft: row ? { content: row.content, params: row.params, updatedAt: row.updatedAt } : null,
      };
    },

    "drafts.put": async ({ key, content, params }) => {
      return { updatedAt: store.putDraft(key, content, params ?? null, Date.now()) };
    },

    "drafts.discard": async ({ key }) => {
      store.discardDraft(key);
      publish({ reason: "drafts" });
      return { ok: true } as const;
    },

    "drafts.list": async () => {
      return { drafts: store.listDrafts() };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}

/** Internal: trims a settings folder value into a clean relative folder or "". */
function normalizeFolder(folder: string): string {
  const clean = folder.trim().replace(/^\/+|\/+$/g, "");
  if (clean === "") return "";
  if (clean.split("/").some((segment) => segment === "." || segment === ".." || segment.startsWith("."))) {
    return "diagrams";
  }
  return clean;
}

/** The docs plugin surfaces missing files as plain handler errors; mirror its own heuristic. */
function isMissingVaultFile(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /\bENOENT\b|path does not exist|not found/i.test(message);
}
