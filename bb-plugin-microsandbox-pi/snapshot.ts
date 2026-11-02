// bb-plugin-microsandbox-pi — shared data vocabulary.
//
// The plugin watches two toolchains on every machine bb talks to:
// the microsandbox CLI (`msb`) and the pi coding agent (`pi`). One
// snapshot per machine is produced by the host artifact (probe.ts),
// persisted per host by the server (store.ts), and rendered by the
// page (app.tsx) and CLI (cli-msb-pi.ts). Everything below is plain,
// JSON-safe shape with zod at the wire boundaries.
import { z } from "zod";

/** One toolchain probed on one machine. Absence is data, not an error:
 * `version: null` + `error: null` means "not found". Optional fields
 * stay optional so snapshots persisted by 0.1.0 still validate. */
export const toolStatusSchema = z
  .object({
    version: z.string().nullable(),
    /** Resolved binary or active release directory; null when not found. */
    path: z.string().nullable(),
    /** Short human explainer: "managed install", "PATH", "extra path", … */
    origin: z.string().nullable(),
    /** One supplementary line: managed root, state dir, probe notes. */
    detail: z.string().nullable(),
    /** Extra installed versions beyond the active one (pi keeps releases/). */
    installedVersions: z.array(z.string()).nullable(),
    /** Non-null when the tool was found but probing it failed. */
    error: z.string().nullable(),
    /** npm package name this install maps to, when derivable. */
    packageName: z.string().nullable().optional(),
  })
  .strict();
export type ToolStatus = z.infer<typeof toolStatusSchema>;

/** One sandbox of the machine's msb runtime (`msb list`).*/
export const boxEntrySchema = z
  .object({
    name: z.string(),
    image: z.string().nullable(),
    status: z.string(),
    createdAt: z.string().nullable(),
  })
  .strict();
export type BoxEntry = z.infer<typeof boxEntrySchema>;

/** Boxes view of the machine's msb runtime; null means no msb or an
 * unreadable runtime. `error` carries the reason when present. */
export const boxesViewSchema = z
  .object({
    boxes: z.array(boxEntrySchema).nullable(),
    error: z.string().nullable(),
  })
  .strict();
export type BoxesView = z.infer<typeof boxesViewSchema>;

export const machineSnapshotSchema = z
  .object({
    checkedAt: z.number(),
    platform: z.string(),
    pi: toolStatusSchema,
    msb: toolStatusSchema,
    /** In-box view: the machine's own msb runtime inventory. */
    boxes: boxesViewSchema.optional(),
  })
  .strict();
export type MachineSnapshot = z.infer<typeof machineSnapshotSchema>;

/** Input the server hands the host artifact when asking for a snapshot. */
export const snapshotArgsSchema = z
  .object({
    /** Directories or binary paths to also look at for `msb`. */
    extraMsbPaths: z.array(z.string()),
    /** Override for the pi managed-install root; "" means auto-detect. */
    piManagedRoot: z.string(),
  })
  .strict();
export type SnapshotArgs = z.infer<typeof snapshotArgsSchema>;

/** Persisted per-host view the server keeps between probes. */
export const machineStateSchema = z
  .object({
    hostId: z.string(),
    hostName: z.string(),
    connected: z.boolean(),
    snapshot: machineSnapshotSchema.nullable(),
    lastError: z.string().nullable(),
    lastErrorAt: z.number().nullable(),
  })
  .strict();
export type MachineState = z.infer<typeof machineStateSchema>;

/** A version transition worth remembering. */
export const historyEntrySchema = z
  .object({
    at: z.number(),
    hostId: z.string(),
    hostName: z.string(),
    tool: z.enum(["pi", "msb"]),
    kind: z.enum(["added", "changed", "removed"]),
    from: z.string().nullable(),
    to: z.string().nullable(),
  })
  .strict();
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type HistoryKind = HistoryEntry["kind"];

/** Cached npm registry answer for one package. `stale` marks data
 * kept past its TTL because a refetch failed. */
export const npmLatestEntrySchema = z
  .object({
    packageName: z.string(),
    version: z.string().nullable(),
    fetchedAt: z.number(),
    stale: z.boolean(),
  })
  .strict();
export type NpmLatestEntry = z.infer<typeof npmLatestEntrySchema>;

export const watchOutputSchema = z
  .object({
    generatedAt: z.number(),
    machines: z.array(machineStateSchema),
    history: z.array(historyEntrySchema),
    /** npm registry "latest" for the packages the fleet actually has. */
    npmLatest: z.array(npmLatestEntrySchema).optional(),
  })
  .strict();
export type WatchOutput = z.infer<typeof watchOutputSchema>;

/** History is capped so the kv row stays comfortably under 256 KiB. */
export const HISTORY_CAP = 200;

/** Tools in fixed display order everywhere (page, CLI, diffs). */
export const WATCHED_TOOLS = ["pi", "msb"] as const;
export type WatchedTool = (typeof WATCHED_TOOLS)[number];
