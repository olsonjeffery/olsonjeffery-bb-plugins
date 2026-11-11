// bb-plugin-drawio — the plugin's own frontend ⇄ backend RPC contract.
//
// server.ts registers the handlers; app.tsx imports this module TYPE-ONLY so
// the backend (and the Docs adapter it pulls in) is erased from the frontend
// bundle. Shared non-RPC vocabulary — tab params, vault file entries, the
// mxfile starter, draft-key encoding — lives here too, because both sides
// must agree on it.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/** The installed-plugin id of the bundled official Docs plugin. */
export const DOCS_PLUGIN_ID = "simple-notes";

/** Where a `.drawio` document lives. Tab params carry exactly one of these. */
export type DocRef =
  | { kind: "vault"; vaultId: string; path: string }
  | {
      kind: "file";
      source: FileSourceJson;
      path: string;
    };

/** Mirrors the fileOpener's `source` prop (hostId normalized from experimental_hostId). */
export const FileSourceJson = z
  .object({
    kind: z.enum(["workspace", "host", "thread-storage"]),
    threadId: z.string().nullable(),
    environmentId: z.string().nullable(),
    projectId: z.string().nullable(),
    hostId: z.string().optional(),
  })
  .strict();
export type FileSourceJson = z.infer<typeof FileSourceJson>;

/** What an open-diagram action tab persists across restarts. */
export type DiagramTabParams =
  | DocRef
  | { kind: "draft"; draftKey: string }
  | { kind: "home" };

/** A `.drawio` file in a Docs vault, as the vault cache reports it. */
export const VaultFileEntry = z.object({
  path: z.string(),
  sha256: z.string(),
  sizeBytes: z.number(),
  modifiedAtMs: z.number(),
});
export type VaultFileEntry = z.infer<typeof VaultFileEntry>;

export const VaultSummary = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  hostId: z.string().nullable(),
});
export type VaultSummary = z.infer<typeof VaultSummary>;

/** One recovered draft row (untitled work the user closed without saving). */
export const DraftSummary = z.object({
  key: z.string(),
  content: z.string(),
  params: z.string().nullable(),
  updatedAt: z.number(),
});
export type DraftSummary = z.infer<typeof DraftSummary>;

// Draft keys are plain strings, but every surface builds them the same way:
//   vault:<vaultId>:<path>      — a vault document
//   file:<kind>|<scope ids>|<path> — a workspace/host document
//   untitled:<uuid>             — a never-saved diagram
export const UNTITLED_PREFIX = "untitled:";

export function vaultDraftKey(vaultId: string, path: string): string {
  return `vault:${vaultId}:${path}`;
}

export function fileDraftKey(source: FileSourceJson, path: string): string {
  const scope = [
    source.kind,
    source.threadId ?? "",
    source.environmentId ?? "",
    source.projectId ?? "",
    source.hostId ?? "",
  ].join("|");
  return `file:${scope}:${path}`;
}

/**
 * A minimal but valid mxfile: one empty page. The editor's own chrome builds
 * the rest as soon as the user draws something.
 */
export const STARTER_XML =
  '<mxfile host="bb-plugin-drawio">' +
  '<diagram id="page-1" name="Page-1">' +
  '<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" ' +
  'connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" ' +
  'math="0" shadow="0">' +
  "<root>" +
  '<mxCell id="0" />' +
  '<mxCell id="1" parent="0" />' +
  "</root>" +
  "</mxGraphModel>" +
  "</diagram>" +
  "</mxfile>";

// ---------------------------------------------------------------------------
// Validation shared by the contract boundary
// ---------------------------------------------------------------------------

const MAX_PATH_LENGTH = 600;
const MAX_CONTENT_LENGTH = 4_000_000; // 4 MB of XML is a huge diagram

/** Rules a Docs vault path must satisfy (mirrors the docs plugin's own). */
export function isValidVaultPath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  if (path.startsWith("/")) return false;
  return path.split("/").every(
    (segment) =>
      segment.length > 0 && segment !== "." && segment !== ".." && !segment.startsWith("."),
  );
}

export const VaultPath = z
  .string()
  .refine(isValidVaultPath, "Invalid vault path");
export const VaultDiagramPath = z
  .string()
  .refine(
    (path) => isValidVaultPath(path) && path.toLowerCase().endsWith(".drawio"),
    "Path must be a .drawio file inside the vault",
  );
export const DiagramContent = z.string().max(MAX_CONTENT_LENGTH);
export const DraftKey = z
  .string()
  .min(1)
  .max(800)
  .refine(
    (key) =>
      key.startsWith("vault:") ||
      key.startsWith("file:") ||
      key.startsWith(UNTITLED_PREFIX),
    "Unknown draft key shape",
  );

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

const SaveOutcome = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("written"), sha256: z.string() }).strict(),
  z
    .object({ outcome: z.literal("conflict"), currentSha256: z.string().nullable() })
    .strict(),
]);

export const rpcContract = defineRpcContract({
  "config.status": {
    input: z.null(),
    output: z
      .object({
        configured: z.boolean(),
        instanceUrl: z.string(),
        docsAvailable: z.boolean(),
        defaultVaultId: z.string(),
        defaultFolder: z.string(),
        uiTheme: z.enum(["min", "sketch", "atlas"]),
      })
      .strict(),
  },

  "vault.list": {
    input: z.null(),
    output: z.object({ vaults: z.array(VaultSummary) }).strict(),
  },
  "vault.files": {
    input: z.object({ vaultId: z.string().min(1), refresh: z.boolean() }).strict(),
    output: z
      .object({
        files: z.array(VaultFileEntry),
        refreshedAtMs: z.number(),
        stale: z.boolean(),
      })
      .strict(),
  },
  "vault.read": {
    input: z.object({ vaultId: z.string().min(1), path: VaultDiagramPath }).strict(),
    output: z
      .object({
        content: z.string(),
        sha256: z.string(),
        modifiedAtMs: z.number().nullable(),
      })
      .strict(),
  },
  "vault.write": {
    input: z
      .object({
        vaultId: z.string().min(1),
        path: VaultDiagramPath,
        content: DiagramContent,
        expectedSha256: z.string().optional(),
      })
      .strict(),
    output: SaveOutcome,
  },
  "vault.create": {
    input: z
      .object({ vaultId: z.string().min(1), path: VaultDiagramPath, content: DiagramContent })
      .strict(),
    output: SaveOutcome,
  },
  "vault.move": {
    input: z
      .object({ vaultId: z.string().min(1), from: VaultPath, to: VaultPath })
      .strict(),
    output: z.object({ path: z.string() }).strict(),
  },
  "vault.delete": {
    input: z
      .object({
        vaultId: z.string().min(1),
        path: VaultPath,
        recursive: z.boolean().optional(),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  "vault.createFolder": {
    input: z.object({ vaultId: z.string().min(1), path: VaultPath }).strict(),
    output: z.object({ path: z.string() }).strict(),
  },

  "workspace.read": {
    input: z
      .object({ source: FileSourceJson, path: z.string().min(1).max(1200) })
      .strict(),
    output: z
      .object({
        content: z.string(),
        sha256: z.string(),
        modifiedAtMs: z.number().nullable(),
      })
      .strict(),
  },
  "workspace.write": {
    input: z
      .object({
        source: FileSourceJson,
        path: z.string().min(1).max(1200),
        content: DiagramContent,
        expectedSha256: z.string().optional(),
      })
      .strict(),
    output: SaveOutcome,
  },

  "drafts.get": {
    input: z.object({ key: DraftKey }).strict(),
    output: z
      .object({
        draft: z
          .object({
            content: z.string(),
            params: z.string().nullable(),
            updatedAt: z.number(),
          })
          .nullable(),
      })
      .strict(),
  },
  "drafts.put": {
    input: z
      .object({
        key: DraftKey,
        content: DiagramContent,
        params: z.string().nullish(),
      })
      .strict(),
    output: z.object({ updatedAt: z.number() }).strict(),
  },
  "drafts.discard": {
    input: z.object({ key: DraftKey }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  "drafts.list": {
    input: z.null(),
    output: z.object({ drafts: z.array(DraftSummary) }).strict(),
  },
});

/** The realtime channel the backend publishes on after any cache/draft write. */
export const REALTIME_CHANNEL = "drawio";
