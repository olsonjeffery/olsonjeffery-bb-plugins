// bb-plugin-drawio — backend behavior over the fake plugin host: the
// needs-configuration posture, docs-RPC degradation, the vault cache with CAS
// writes and conflicts, workspace persistence, and the drafts net.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import { z } from "zod";
import plugin from "./server.js";
import { DOCS_PLUGIN_ID, STARTER_XML } from "./contract.js";

// The docs plugin contract responses the fake `callRpc` serves.
function docsHarness() {
  const calls: Array<{ method: string; input: unknown }> = [];
  let respond: (method: string, input: unknown) => unknown = () => {
    throw new Error("no docs behavior configured");
  };
  const callRpc = vi.fn(async (args: { method: string; input?: unknown; outputSchema: z.ZodType }) => {
    calls.push({ method: args.method, input: args.input });
    const result = respond(args.method, args.input);
    return args.outputSchema.parse(result);
  });
  return { calls, callRpc, setRespond: (fn: typeof respond) => (respond = fn) };
}

const DOCS_ROW = { id: DOCS_PLUGIN_ID, enabled: true, status: "running" };

interface HostOptions {
  settings?: Record<string, string>;
  callRpc?: ReturnType<typeof docsHarness>["callRpc"];
  plugins?: Array<{ id: string; enabled: boolean; status: string }>;
  files?: { read?: ReturnType<typeof vi.fn>; write?: ReturnType<typeof vi.fn> };
}

async function makeHost(options: HostOptions = {}): Promise<{
  host: FakePluginHost;
  docs: ReturnType<typeof docsHarness> | null;
}> {
  const docs =
    options.callRpc !== undefined
      ? { calls: [], callRpc: options.callRpc, setRespond: () => undefined }
      : null;
  const { bb, harness } = createFakePluginHost({
    pluginId: "drawio",
    settings: options.settings,
    sdk: {
      plugins: {
        list: async () => ({ plugins: options.plugins ?? [DOCS_ROW] }),
        callRpc: options.callRpc ?? (async () => {
          throw new Error("no docs RPC");
        }),
      },
      system: { config: async () => ({ primaryHostId: "host1" }) },
      files: {
        read: options.files?.read ?? (async () => {
          throw new Error("files.read not stubbed");
        }),
        write: options.files?.write ?? (async () => {
          throw new Error("files.write not stubbed");
        }),
      },
    },
  });
  await plugin(bb);
  return { host: harness as unknown as FakePluginHost, docs };
}

describe("drawio backend", () => {
  describe("needs-configuration posture", () => {
    it("reports needs-configuration until an instance URL exists", async () => {
      const { host } = await makeHost({ settings: { instanceUrl: "" } });
      expect(host.needsConfigurationMessages.join("\n")).toContain("instance URL");
      expect(host.behavior.callRpc("config.status", null)).resolves.toBeTruthy();
    });

    it("loads clean with an instance URL", async () => {
      const { host } = await makeHost({ settings: { instanceUrl: "http://draw.example.com" } });
      expect(host.needsConfigurationMessages).toHaveLength(0);
    });
  });

  describe("config.status", () => {
    it("reports configured, docs availability, and settings", async () => {
      const docs = docsHarness();
      docs.setRespond((method) => {
        if (method === "listNotes") {
          return {
            vaults: [{ id: "v1", name: "Personal", hostId: null, rootPath: "/notes" }],
            vault: { id: "v1", name: "Personal", hostId: null, rootPath: "/notes" },
            hosts: [],
            entries: [],
            entryOrder: [],
            notes: [],
            truncated: false,
            error: null,
          };
        }
        throw new Error(`unexpected method ${method}`);
      });
      const { host } = await makeHost({
        settings: { instanceUrl: "http://draw.example.com/", defaultFolder: "diagrams/" },
        callRpc: docs.callRpc,
      });
      const status = await host.behavior.callRpc("config.status", null);
      expect(status).toEqual({
        configured: true,
        instanceUrl: "http://draw.example.com",
        docsAvailable: true,
        defaultVaultId: "",
        defaultFolder: "diagrams",
        uiTheme: "min",
      });
    });

    it("degrades docsAvailable when the docs plugin is missing", async () => {
      const { host } = await makeHost({ settings: { instanceUrl: "http://d.example" }, plugins: [] });
      const status = await host.behavior.callRpc("config.status", null);
      expect(status.configured).toBe(true);
      expect(status.docsAvailable).toBe(false);
    });

    it("degrades docsAvailable when the probe fails", async () => {
      const failing = vi.fn(async () => {
        throw new Error("unknown_method");
      });
      const { host } = await makeHost({ settings: { instanceUrl: "http://d.example" }, callRpc: failing });
      const status = await host.behavior.callRpc("config.status", null);
      expect(status.docsAvailable).toBe(false);
    });
  });

  describe("vault persistence", () => {
    it("caches a full snapshot, then serves .drawio discovery from SQLite", async () => {
      const docs = docsHarness();
      let snapshotCount = 0;
      docs.setRespond((method, input) => {
        if (method === "listNotes") return emptyListNotes();
        if (method === "syncSnapshot") {
          snapshotCount += 1;
          const scope = (input as { scope: { kind: string } }).scope;
          expect(scope.kind).toBe("all");
          return {
            files: [
              file("diagrams/a.drawio", "AAA", 10),
              file("notes/todo.md", "mmm", 3),
              file("diagrams/b.drawio", "BBB", 12),
            ],
            directories: ["diagrams", "notes"],
          };
        }
        if (method === "readNote") {
          const path = (input as { path: string }).path;
          return {
            path,
            content: path === "diagrams/a.drawio" ? "AAA" : "BBB",
            contentEncoding: "utf8",
            sizeBytes: 3,
            sha256: path === "diagrams/a.drawio" ? "sha-a" : "sha-b",
            modifiedAtMs: 1000,
          };
        }
        throw new Error(`unexpected method ${method}`);
      });
      const { host } = await makeHost({ settings: { instanceUrl: "http://d.example" }, callRpc: docs.callRpc });

      const first = await host.behavior.callRpc("vault.files", { vaultId: "v1", refresh: false });
      expect(snapshotCount).toBe(1);
      // The browser is a complete vault browser: every file type is cached,
      // not just .drawio (bb's own Docs browser hides non-Markdown files).
      expect(first.files.map((entry: { path: string }) => entry.path)).toEqual([
        "diagrams/a.drawio",
        "diagrams/b.drawio",
        "notes/todo.md",
      ]);

      // Second read: served from the cache, no second snapshot.
      const second = await host.behavior.callRpc("vault.files", { vaultId: "v1", refresh: false });
      expect(snapshotCount).toBe(1);
      expect(second.files).toEqual(first.files);

      // Explicit refresh re-snapshots.
      await host.behavior.callRpc("vault.files", { vaultId: "v1", refresh: true });
      expect(snapshotCount).toBe(2);
    });

    it("writes with CAS and updates the cache; conflicts surface as outcomes", async () => {
      const docs = docsHarness();
      docs.setRespond((method, input) => {
        if (method === "listNotes") return emptyListNotes();
        if (method === "saveNote") {
          const { path, expectedSha256 } = input as { path: string; expectedSha256?: string | null };
          if (path === "diagrams/blocked.drawio" && expectedSha256 === "stale") {
            return { outcome: "conflict", currentSha256: "fresh" };
          }
          return { outcome: "written", sha256: "new-sha", sizeBytes: 42 };
        }
        throw new Error(`unexpected method ${method}`);
      });
      const { host } = await makeHost({ settings: { instanceUrl: "http://d.example" }, callRpc: docs.callRpc });

      const written = await host.behavior.callRpc("vault.write", {
        vaultId: "v1",
        path: "diagrams/a.drawio",
        content: "<mxfile/>",
        expectedSha256: "sha-a",
      });
      expect(written).toEqual({ outcome: "written", sha256: "new-sha" });

      const conflicted = await host.behavior.callRpc("vault.write", {
        vaultId: "v1",
        path: "diagrams/blocked.drawio",
        content: "<mxfile/>",
        expectedSha256: "stale",
      });
      expect(conflicted).toEqual({ outcome: "conflict", currentSha256: "fresh" });

      // Create-only writes pass expectedSha256: null.
      const create = await host.behavior.callRpc("vault.create", {
        vaultId: "v1",
        path: "diagrams/new.drawio",
        content: STARTER_XML,
      });
      expect(create.outcome).toBe("written");
      const saveCall = docs.calls.findLast((call) => call.method === "saveNote");
      expect((saveCall?.input as { expectedSha256?: unknown }).expectedSha256).toBeNull();
    });

    it("read of a deleted diagram self-heals the cache and reports not_found", async () => {
      const docs = docsHarness();
      docs.setRespond((method, input) => {
        if (method === "listNotes") return emptyListNotes();
        if (method === "syncSnapshot") {
          return {
            files: [file("diagrams/gone.drawio", "AAA", 10)],
            directories: ["diagrams"],
          };
        }
        if (method === "readNote") {
          throw new Error("HTTP 404: Path does not exist: /notes/diagrams/gone.drawio");
        }
        throw new Error(`unexpected method ${method}`);
      });
      const { host } = await makeHost({ settings: { instanceUrl: "http://d.example" }, callRpc: docs.callRpc });

      // Cache the entry, then watch the missing-file read retire it.
      await host.behavior.callRpc("vault.files", { vaultId: "v1", refresh: false });
      await expect(
        host.behavior.callRpc("vault.read", { vaultId: "v1", path: "diagrams/gone.drawio" }),
      ).rejects.toThrow(/does not exist in the vault/);
      const after = await host.behavior.callRpc("vault.files", { vaultId: "v1", refresh: false });
      expect(after.files).toEqual([]);
    });

    it("delete discards the document's draft", async () => {
      const docs = docsHarness();
      docs.setRespond((method) => {
        if (method === "listNotes") return emptyListNotes();
        if (method === "deletePath") return { ok: true };
        throw new Error(`unexpected method ${method}`);
      });
      const { host } = await makeHost({ settings: { instanceUrl: "http://d.example" }, callRpc: docs.callRpc });
      await host.behavior.callRpc("drafts.put", {
        key: "vault:v1:diagrams/gone.drawio",
        content: "<mxfile/>",
      });
      expect((await host.behavior.callRpc("drafts.get", { key: "vault:v1:diagrams/gone.drawio" })).draft).not.toBeNull();
      await host.behavior.callRpc("vault.delete", { vaultId: "v1", path: "diagrams/gone.drawio" });
      expect((await host.behavior.callRpc("drafts.get", { key: "vault:v1:diagrams/gone.drawio" })).draft).toBeNull();
    });
  });

  describe("workspace persistence", () => {
    it("resolves project workspaces and saves with CAS", async () => {
      const files = {
        read: vi.fn(async () => ({
          path: "/proj/app/flow.drawio",
          content: "<mxfile/>",
          contentEncoding: "utf8",
          sha256: "sha-w",
          sizeBytes: 9,
          modifiedAtMs: 55,
        })),
        write: vi.fn(async (args: { expectedSha256?: string | null }) =>
          args.expectedSha256 === "stale"
            ? { outcome: "conflict", currentSha256: "other" }
            : { outcome: "written", sha256: "new-w", sizeBytes: 9 },
        ),
      };
      const { host } = await makeHost({
        settings: { instanceUrl: "http://d.example" },
        files,
      });
      // Project-backed workspace: sdk.projects.get resolves the source path.
      host.sdk.stub("projects.get", async () => ({
        id: "p1",
        name: "P",
        kind: "standard",
        sources: [{ id: "s1", projectId: "p1", hostId: "host1", path: "/proj", type: "local_path", isDefault: true, createdAt: 0, updatedAt: 0 }],
        createdAt: 0,
        updatedAt: 0,
      }));

      const read = await host.behavior.callRpc("workspace.read", {
        source: { kind: "workspace", threadId: null, environmentId: null, projectId: "p1" },
        path: "app/flow.drawio",
      });
      expect(read).toEqual({ content: "<mxfile/>", sha256: "sha-w", modifiedAtMs: 55 });
      expect(files.read.mock.calls[0]?.[0]).toMatchObject({
        hostId: "host1",
        path: "/proj/app/flow.drawio",
        rootPath: "/proj",
      });

      const written = await host.behavior.callRpc("workspace.write", {
        source: { kind: "workspace", threadId: null, environmentId: null, projectId: "p1" },
        path: "app/flow.drawio",
        content: "<mxfile v2/>",
        expectedSha256: "sha-w",
      });
      expect(written).toEqual({ outcome: "written", sha256: "new-w" });
      expect(files.write.mock.calls[0]?.[0]).toMatchObject({
        path: "/proj/app/flow.drawio",
        rootPath: "/proj",
        content: "<mxfile v2/>",
        expectedSha256: "sha-w",
      });
    });
  });

  describe("drafts", () => {
    it("round-trips put/get/list/discard", async () => {
      const { host } = await makeHost({ settings: { instanceUrl: "http://d.example" } });
      const { updatedAt } = await host.behavior.callRpc("drafts.put", {
        key: "untitled:abc",
        content: "<mxfile/>",
        params: null,
      });
      expect(updatedAt).toBeGreaterThan(0);

      const got = await host.behavior.callRpc("drafts.get", { key: "untitled:abc" });
      expect(got.draft).toMatchObject({ content: "<mxfile/>" });

      const listed = await host.behavior.callRpc("drafts.list", null);
      expect(listed.drafts.map((draft: { key: string }) => draft.key)).toEqual(["untitled:abc"]);

      await host.behavior.callRpc("drafts.discard", { key: "untitled:abc" });
      expect((await host.behavior.callRpc("drafts.get", { key: "untitled:abc" })).draft).toBeNull();
    });

    it("rejects unknown key shapes at the boundary", async () => {
      const { host } = await makeHost({ settings: { instanceUrl: "http://d.example" } });
      await expect(host.behavior.callRpc("drafts.put", { key: "junk:1", content: "x" })).rejects.toThrow();
    });
  });
});

// helpers -------------------------------------------------------------------

function emptyListNotes() {
  return {
    vaults: [{ id: "v1", name: "Personal", hostId: null, rootPath: "/notes" }],
    vault: { id: "v1", name: "Personal", hostId: null, rootPath: "/notes" },
    hosts: [],
    entries: [],
    entryOrder: [],
    notes: [],
    truncated: false,
    error: null,
  };
}

function file(path: string, content: string, size: number) {
  return {
    remotePath: path,
    localPath: path,
    sha256: `sha-${path}`,
    sizeBytes: size,
    contentEncoding: "utf8",
    mimeType: null,
    modifiedAtMs: 100,
    content,
  };
}
