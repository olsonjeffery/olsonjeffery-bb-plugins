// bb-plugin-spools — agent-facing CLI (`bb spools …`).
//
// Spool membership is per-thread plugin metadata (pluginId "spools"), so the
// CLI can read and rewrite the same state the sidebar does, with the same
// rules: spools never nest (memberPatch rewrites the full key-set, joining
// breaks out of any previous spool), child threads follow their parent, and
// a member moved to a section re-files the whole spool.
import {
  PluginCliError,
  cliCommand,
  defineCli,
  type BbPluginApi,
  type JsonValue,
  type PluginCliRegistration,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import {
  deriveSpools,
  familyOf,
  newSpoolId,
  planMetadataWrites,
  SPOOL_ID_PREFIX,
  type Spool,
  type SpoolMembership,
} from "./components/spooler/spoolStore";

type ThreadRows = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>;

export interface SpoolThread {
  id: string;
  title: string | null;
  displayTitle: string;
  sectionId: string | null;
  parentThreadId: string | null;
}

export interface SpoolWorld {
  threads: SpoolThread[];
  threadById: Map<string, SpoolThread>;
  sectionNameById: Map<string, string>;
  spools: Spool[];
  membership: ReadonlyMap<string, SpoolMembership>;
  /** parentId → child ids, in list order; feeds the family-join rule. */
  childrenOf: Map<string, string[]>;
}

/** Every thread the CLI can see, plus spool metadata and section names. */
async function loadWorld(bb: BbPluginApi): Promise<SpoolWorld> {
  const rows: ThreadRows[number][] = [];
  const collect = (page: ThreadRows) => {
    const seen = new Set(rows.map((row) => row.id));
    for (const row of page) if (!seen.has(row.id)) rows.push(row);
  };
  // `archived` covers whatever the plain list excludes; merge so family
  // joins and mv targets survive archiving.
  collect(await bb.sdk.threads.list({}));
  collect(await bb.sdk.threads.list({ archived: true }));

  const threads: SpoolThread[] = rows.map((row) => ({
    id: row.id,
    title: row.title ?? null,
    displayTitle: row.title ?? row.titleFallback ?? row.id,
    sectionId: row.sectionId ?? null,
    parentThreadId: row.parentThreadId ?? null,
  }));
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));

  const childrenOf = new Map<string, string[]>();
  for (const thread of threads) {
    const parent = thread.parentThreadId;
    if (!parent || !threadById.has(parent)) continue;
    const kids = childrenOf.get(parent) ?? [];
    kids.push(thread.id);
    childrenOf.set(parent, kids);
  }

  const metadataByThreadId = new Map<string, Record<string, unknown>>();
  for (let start = 0; start < threads.length; start += 200) {
    const chunk = threads.slice(start, start + 200);
    const result = await bb.sdk.threads.experimental_listPluginMetadata({
      threadIds: chunk.map((thread) => thread.id),
    });
    for (const row of result.threads) {
      metadataByThreadId.set(row.threadId, (row.metadata ?? {}) as Record<string, unknown>);
    }
  }

  const collapsed = await bb.sdk.threadSections.list();
  const sectionNameById = new Map(
    collapsed.map((section) => [section.id, section.name]),
  );

  const { spools, membershipByThreadId } = deriveSpools({
    threads,
    metadataByThreadId,
  });
  return {
    threads,
    threadById,
    sectionNameById,
    spools,
    membership: membershipByThreadId,
    childrenOf,
  };
}

/** Resolve a spool reference: spool id (exact/prefix) or 1-based list index. */
export function findSpool(world: SpoolWorld, ref: string): Spool {
  const trimmed = ref.trim();
  if (!trimmed) throw new PluginCliError("Missing spool reference.", { code: "usage" });
  const byId = world.spools.find((spool) => spool.id === trimmed);
  if (byId) return byId;
  if (/^\d+$/.test(trimmed)) {
    const spool = world.spools[Number(trimmed) - 1];
    if (spool) return spool;
  } else {
    const prefix = world.spools.filter(
      (spool) =>
        spool.id.startsWith(trimmed) ||
        (spool.id.startsWith(SPOOL_ID_PREFIX) &&
          spool.id.slice(SPOOL_ID_PREFIX.length).startsWith(trimmed)),
    );
    if (prefix.length === 1) return prefix[0];
  }
  throw new PluginCliError(
    `No spool matches “${ref}”. Run \`bb spools list\` to see current spools.`,
    { code: "spool_not_found", hint: "Use the spool id, its id prefix, or its 1-based list index." },
  );
}

/**
 * Resolve a thread reference: exact id, unique id prefix, or unique
 * case-insensitive title / title-fallback substring.
 */
export function findThread(world: SpoolWorld, ref: string): SpoolThread {
  const trimmed = ref.trim();
  if (!trimmed) throw new PluginCliError("Missing thread reference.", { code: "usage" });
  const exact = world.threadById.get(trimmed);
  if (exact) return exact;
  const lower = trimmed.toLowerCase();
  const matches = world.threads.filter(
    (thread) =>
      (thread.id.startsWith(trimmed)) ||
      thread.displayTitle.toLowerCase().includes(lower),
  );
  if (matches.length === 1) return matches[0];
  const sample = matches.slice(0, 5).map((m) => `  ${m.id.slice(0, 8)}  ${m.displayTitle}`);
  throw new PluginCliError(
    matches.length === 0
      ? `No thread matches “${ref}”.`
      : `“${ref}” matches several threads:\n${sample.join("\n")}`,
    { code: "thread_not_found", hint: "Use the thread id (or a longer id prefix/unique title)." },
  );
}

/** Resolve a section reference by name or id; "none"/"unfiled" unfiles. */
export function findSectionId(
  world: SpoolWorld,
  ref: string,
): string | null {
  const trimmed = ref.trim().toLowerCase();
  if (!trimmed || trimmed === "none" || trimmed === "unfiled") return null;
  const exactName = Array.from(world.sectionNameById.entries()).find(
    ([, name]) => name.toLowerCase() === trimmed,
  );
  if (exactName) return exactName[0];
  const prefixed = Array.from(world.sectionNameById.entries()).filter(([id, name]) =>
    id.startsWith(trimmed) || name.toLowerCase().startsWith(trimmed),
  );
  if (prefixed.length === 1) return prefixed[0][0];
  throw new PluginCliError(
    `No section matches “${ref}”. Known sections: ${
      Array.from(world.sectionNameById.values()).join(", ") || "(none)"
    } — or use "none".`,
    { code: "section_not_found" },
  );
}

export function listBody(world: SpoolWorld): string {
  if (world.spools.length === 0) return "No spools. Create one in the sidebar (Group by section) or with `bb spools mv-spool <thread> new`.";
  const lines: string[] = [];
  world.spools.forEach((spool, index) => {
    const sectionName = spool.leadThreadId
      ? world.sectionNameById.get(world.threadById.get(spool.leadThreadId)?.sectionId ?? "") ?? "Unfiled"
      : "Unfiled";
    lines.push(`${index + 1}. ${spool.title}  (${spool.members.length})  ${spool.id}  [${sectionName}]`);
    for (const memberId of spool.members) {
      const thread = world.threadById.get(memberId);
      const top = memberId === spool.leadThreadId ? " (Top)" : "";
      const section =
        thread && thread.sectionId ? world.sectionNameById.get(thread.sectionId) ?? thread.sectionId : "Unfiled";
      lines.push(`   - ${thread?.displayTitle ?? memberId}${top}  [${section}]`);
    }
  });
  return lines.join("\n");
}

/** Run a mutation body after loading the world (shared error surface). */
async function withWorld(
  bb: BbPluginApi,
  run: (world: SpoolWorld) => PluginCliResult | Promise<PluginCliResult>,
): Promise<PluginCliResult> {
  const world = await loadWorld(bb);
  return run(world);
}

export function buildSpoolsCli(bb: BbPluginApi): PluginCliRegistration {
  const list = cliCommand({
    summary: "List spools and their member threads.",
    description:
      "Spool membership lives on the threads (pluginId=\"spools\"), so this reads live state. `--json` prints the resolved spools.",
    options: { json: { type: "boolean", description: "Print the resolved spools as JSON." } },
    run: (input) =>
      withWorld(bb, (world) => ({
        exitCode: 0,
        stdout: input.options.json
          ? JSON.stringify(
              world.spools.map((spool, index) => ({
                index: index + 1,
                id: spool.id,
                title: spool.title,
                leadThreadId: spool.leadThreadId,
                members: spool.members.map((memberId) => ({
                  id: memberId,
                  title: world.threadById.get(memberId)?.displayTitle ?? null,
                  sectionId: world.threadById.get(memberId)?.sectionId ?? null,
                  lead: memberId === spool.leadThreadId,
                })),
              })),
              null,
              2,
            )
          : listBody(world),
      })),
  });

  const mvSection = cliCommand({
    summary: "Move threads to a section (unfile with \"none\").",
    description:
      "<thread> matches a thread id, id prefix, or title. <section> matches a section name or id; \"none\" unfiles. Moving a spool member re-files every member of that spool, like dragging the card.",
    positionals: [
      { name: "thread", description: "Thread id, id prefix, or title", required: true },
      { name: "section", description: "Section name or id, or \"none\"", required: true },
    ],
    run: async (input) =>
      withWorld(bb, (world) => {
        const thread = findThread(world, input.positionals.thread);
        const sectionId = findSectionId(world, input.positionals.section);
        // A spool member carries the whole spool along.
        const membership = world.membership.get(thread.id);
        const ids = membership
          ? (world.spools.find((spool) => spool.id === membership.id)?.members ?? [thread.id])
          : [thread.id];
        const targets = ids.filter((id) => world.threadById.get(id)?.sectionId !== sectionId);
        if (targets.length === 0) {
          return { exitCode: 0, stdout: `Nothing to move — already filed there.` };
        }
        return Promise.allSettled(
          targets.map((id) => bb.sdk.threads.update({ threadId: id, sectionId })),
        ).then((results) => {
          const ok = results.filter((r) => r.status === "fulfilled").length;
          const failed = results.length - ok;
          const label = sectionId ? world.sectionNameById.get(sectionId) ?? sectionId : "Unfiled";
          if (failed > 0) {
            return {
              exitCode: 1,
              stdout: `Moved ${ok} thread(s).`,
              stderr: `Failed ${failed} of ${results.length}: ${label}.`,
            };
          }
          return { exitCode: 0, stdout: `Moved ${ok} thread(s) to ${label}.` };
        });
      }),
  });

  const mvSpool = cliCommand({
    summary: "Add a thread to a spool, or create a new one with `new`.",
    description:
      "<target> is an existing spool (id, id prefix, or list index) or `new`. The thread joins with its reply family, breaking out of any other spool. `--title` names the spool when the target is `new`.",
    positionals: [
      { name: "thread", description: "Thread id, id prefix, or title", required: true },
      { name: "target", description: "Spool id/prefix, list index, or `new`", required: true },
    ],
    options: { title: { type: "string", description: "Name for the spool when the target is `new`." } },
    run: async (input) =>
      withWorld(bb, (world) => {
        const thread = findThread(world, input.positionals.thread);
        const family = familyOf({ threadId: thread.id, childrenOf: world.childrenOf });
        const title = input.options.title ?? null;

        if (input.positionals.target.trim().toLowerCase() === "new") {
          const writes = planMetadataWrites(
            {
              kind: "create",
              spoolId: newSpoolId(),
              memberIds: [thread.id],
              leadId: thread.id,
              customTitle: title,
              joinedAt: Date.now(),
            },
            world.membership,
          );
          return Promise.allSettled(
            writes.map((write) =>
              bb.sdk.threads.updatePluginMetadata({
                threadId: write.threadId,
                set: write.set as Record<string, JsonValue>,
                remove: write.remove,
              }),
            ),
          ).then(() => ({
            exitCode: 0,
            stdout: `Created a spool around “${thread.displayTitle}”.`,
          }));
        }

        const spool = findSpool(world, input.positionals.target);
        if (world.membership.get(thread.id)?.id === spool.id) {
          return {
            exitCode: 0,
            stdout: `“${thread.displayTitle}” is already in ${spool.title}.`,
          };
        }
        const memberIds = [...family, thread.id];
        const writes = planMetadataWrites(
          {
            kind: "add",
            spoolId: spool.id,
            memberIds,
            joinedAt: Date.now(),
          },
          world.membership,
        );
        return Promise.allSettled(
          writes.map((write) =>
            bb.sdk.threads.updatePluginMetadata({
              threadId: write.threadId,
              set: write.set as Record<string, JsonValue>,
              remove: write.remove,
            }),
          ),
        ).then(() => ({
          exitCode: 0,
          stdout: `Threw ${memberIds.length} thread(s) onto “${spool.title}”.`,
        }));
      }),
  });

  return defineCli({
    name: "spools",
    summary: "Inspect and refile thread spools (pluginId \"spools\").",
    description:
      "A spool books related threads under one card in the sidebar. Membership is per-thread metadata, so the CLI and the sidebar always agree.",
    commands: { list, "mv-section": mvSection, "mv-spool": mvSpool },
  });
}
