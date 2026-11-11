// bb-plugin-drawio — the Docs-vault adapter.
//
// Vault persistence rides the bundled official Docs plugin's RPC (installed
// id `simple-notes`). That contract is NOT a published API surface, so this
// module is deliberately thin and single-purpose:
//
//   - the only place `bb.sdk.plugins.callRpc` appears,
//   - the only place the remote method names and response shapes appear,
//   - the only thing to fix if the docs plugin's contract ever moves.
//
// Availability is feature-detected once per generation (a plugins.list row in
// a running state + one live `listNotes` probe); every caller degrades to
// workspace-only mode when it says no.
import { z } from "zod";
import { DOCS_PLUGIN_ID, type VaultSummary } from "./contract.js";

/** The fields of one plugins.list row we consult. */
export interface InstalledPluginRow {
  id: string;
  enabled: boolean;
  status: string;
}

/** Statuses where the docs plugin exists but cannot serve RPC. */
const UNUSABLE_STATUSES = new Set(["disabled", "missing", "error", "incompatible"]);

export interface DocsAvailability {
  available: boolean;
  reason: string | null;
}

export interface VaultAdapterDeps {
  /** Plugin rows from `bb.sdk.plugins.list()` — fresh per call. */
  listPlugins(): Promise<InstalledPluginRow[]>;
  /**
   * `bb.sdk.plugins.callRpc` bound to the docs plugin. Throws when the call
   * fails for any reason (unknown plugin, contract change, vault I/O).
   */
  callDocsRpc<T>(method: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T>;
  log: {
    warn(message: string): void;
    debug(message: string): void;
  };
}

export class VaultAdapter {
  private detection: Promise<DocsAvailability> | null = null;

  constructor(private readonly deps: VaultAdapterDeps) {}

  /** Fresh availability state. One RPC probe per generation at most. */
  async availability(): Promise<DocsAvailability> {
    if (this.detection === null) {
      this.detection = this.detect().catch(
        (cause: unknown): DocsAvailability => ({
          available: false,
          reason: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
    return this.detection;
  }

  private async detect(): Promise<DocsAvailability> {
    let plugins: InstalledPluginRow[];
    try {
      plugins = await this.deps.listPlugins();
    } catch (cause) {
      return {
        available: false,
        reason: `plugin list failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
    const row = plugins.find((plugin) => plugin.id === DOCS_PLUGIN_ID);
    if (!row) return { available: false, reason: "not installed" };
    if (!row.enabled || UNUSABLE_STATUSES.has(row.status)) {
      return { available: false, reason: `status ${row.status}` };
    }
    try {
      await this.deps.callDocsRpc("listNotes", {}, listNotesSchema);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.deps.log.warn(`docs RPC probe failed; degrading to workspace-only: ${message}`);
      return { available: false, reason: message };
    }
    return { available: true, reason: null };
  }

  /** List the vaults. Empty list is valid; availability must be checked first. */
  async listVaults(): Promise<VaultSummary[]> {
    const result = await this.deps.callDocsRpc("listNotes", {}, listNotesSchema);
    return result.vaults.map((vault: RawVault) => ({
      id: vault.id,
      name: vault.name,
      rootPath: vault.rootPath,
      hostId: vault.hostId,
    }));
  }

  async read(vaultId: string | null, path: string): Promise<RawFile> {
    return this.deps.callDocsRpc("readNote", { vaultId: vaultId ?? undefined, path }, readNoteSchema);
  }

  /**
   * Save with optional CAS. `expectedSha256 === null` means create-only;
   * `undefined` means unconditional overwrite; a string means compare-and-swap.
   */
  async write(
    vaultId: string | null,
    path: string,
    content: string,
    expectedSha256?: string | null,
  ): Promise<RawWriteOutcome> {
    return this.deps.callDocsRpc(
      "saveNote",
      {
        vaultId: vaultId ?? undefined,
        path,
        content,
        ...(expectedSha256 === undefined ? {} : { expectedSha256 }),
      },
      saveNoteSchema,
    );
  }

  async create(vaultId: string | null, parent: string | null, name: string, content: string): Promise<string> {
    const result = await this.deps.callDocsRpc(
      "createNote",
      {
        vaultId: vaultId ?? undefined,
        parent: parent ?? undefined,
        ...(name === "" ? {} : { name }),
        content,
      },
      createNoteSchema,
    );
    return result.path;
  }

  async createFolder(vaultId: string | null, path: string): Promise<string> {
    const result = await this.deps.callDocsRpc(
      "createFolder",
      { vaultId: vaultId ?? undefined, path },
      pathResultSchema,
    );
    return result.path;
  }

  async move(vaultId: string | null, from: string, to: string): Promise<string> {
    const result = await this.deps.callDocsRpc(
      "movePath",
      { vaultId: vaultId ?? undefined, from, to },
      pathResultSchema,
    );
    return result.path;
  }

  async remove(vaultId: string | null, path: string, recursive: boolean): Promise<void> {
    await this.deps.callDocsRpc(
      "deletePath",
      { vaultId: vaultId ?? undefined, path, ...(recursive ? { recursive: true } : {}) },
      okSchema,
    );
  }

  /** Every file in the vault (with content — callers filter to .drawio). */
  async snapshot(
    vaultId: string | null,
    scope: { kind: "all" } | { kind: "folder"; path: string },
  ): Promise<{ files: RawSnapshotFile[]; directories: string[] }> {
    const result = await this.deps.callDocsRpc(
      "syncSnapshot",
      {
        vaultId: vaultId ?? undefined,
        scope: scope.kind === "all" ? { kind: "all" } : { kind: "folder", path: scope.path },
      },
      syncSnapshotSchema,
    );
    return { files: result.files, directories: result.directories };
  }
}

// ---------------------------------------------------------------------------
// Remote schemas (zod mirrors of the docs plugin's own contract)
// ---------------------------------------------------------------------------

interface RawVault {
  id: string;
  name: string;
  hostId: string | null;
  rootPath: string;
}

interface RawFile {
  path: string;
  content: string;
  contentEncoding: "base64" | "utf8";
  sizeBytes: number;
  modifiedAtMs?: number;
  sha256: string;
}

/** Discriminated on purpose: narrowing gives handlers concrete fields. */
type RawWriteOutcome =
  | { outcome: "written"; sha256: string; sizeBytes: number }
  | { outcome: "conflict"; currentSha256: string | null };

interface RawSnapshotFile {
  remotePath: string;
  localPath: string;
  sha256: string;
  sizeBytes: number;
  contentEncoding: "base64" | "utf8";
  mimeType: string | null;
  modifiedAtMs: number | null;
  content: string;
}

// Built with a structural validator rather than trusting the wire: each
// zod object mirrors the docs plugin's own response schema; unknown keys are
// stripped, so additive remote changes pass through unnoticed.

const vaultSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  hostId: z.string().min(1).nullable(),
  rootPath: z.string().min(1),
});

const listNotesSchema = z.object({
  vaults: z.array(vaultSchema),
});

const readNoteSchema = z.object({
  path: z.string(),
  content: z.string(),
  contentEncoding: z.enum(["base64", "utf8"]),
  sizeBytes: z.number(),
  modifiedAtMs: z.number().optional(),
  sha256: z.string(),
});

const saveNoteSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("written"),
    sha256: z.string(),
    sizeBytes: z.number(),
  }),
  z.object({
    outcome: z.literal("conflict"),
    currentSha256: z.string().nullable(),
  }),
]);

const createNoteSchema = z.object({ path: z.string().min(1) });
const pathResultSchema = z.object({ path: z.string().min(1) });
const okSchema = z.object({ ok: z.literal(true) });

const snapshotFileSchema = z.object({
  remotePath: z.string(),
  localPath: z.string(),
  sha256: z.string(),
  sizeBytes: z.number(),
  contentEncoding: z.enum(["base64", "utf8"]),
  mimeType: z.string().nullable(),
  modifiedAtMs: z.number().nullable(),
  content: z.string(),
});

const syncSnapshotSchema = z.object({
  files: z.array(snapshotFileSchema),
  directories: z.array(z.string()),
});

export type { RawFile, RawWriteOutcome, RawSnapshotFile };
