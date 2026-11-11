// bb-plugin-drawio — the workspace adapter over `bb.sdk.files`.
//
// Any `.drawio` file in a project worktree, on a host path, or in thread
// storage opens in the embedded editor. This module resolves the fileOpener's
// source descriptor into the concrete read/write target (absolute path +
// optional rootPath confinement + hostId) and does CAS-guarded reads/writes.
//
// Source resolution mirrors the docs plugin's own `openFile` resolution:
//   workspace + environmentId → the environment's worktree on its host
//   workspace + projectId     → the project's single workspace on that host
//   thread-storage            → the thread's storage root
//   host                      → the absolute path itself (no rootPath)
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { FileSourceJson } from "./contract.js";

export interface ResolvedFile {
  path: string;
  rootPath?: string;
  hostId?: string | null;
}

export interface WorkspaceFile {
  content: string;
  sha256: string;
  modifiedAtMs: number | null;
}

export type WorkspaceWriteOutcome =
  | { outcome: "written"; sha256: string }
  | { outcome: "conflict"; currentSha256: string | null };

/** A minimal slice of BbPluginApi — the sdk.files/sdk.* areas we touch. */
export type WorkspaceDeps = Pick<BbPluginApi, "sdk">;

export class WorkspaceAdapter {
  constructor(private readonly bb: WorkspaceDeps) {}

  async resolve(source: FileSourceJson, path: string): Promise<ResolvedFile> {
    if (source.kind === "host") {
      const absolute = expandHome(path);
      if (!isAbsolute(absolute)) {
        throw new Error(`Host file paths must be absolute: ${path}`);
      }
      return { path: absolute, hostId: source.hostId ?? null };
    }

    if (source.kind === "thread-storage") {
      if (!source.threadId) throw new Error("Thread-storage files require a thread id");
      const location = await this.bb.sdk.threads.storageLocation({ threadId: source.threadId });
      return {
        path: joinPosix(location.storageRootPath, path),
        rootPath: location.storageRootPath,
        hostId: location.hostId,
      };
    }

    // workspace
    if (source.environmentId) {
      const environment = await this.bb.sdk.environments.get({ environmentId: source.environmentId });
      if (!environment.path) throw new Error("This environment has no workspace path");
      return {
        path: joinPosix(environment.path, path),
        rootPath: environment.path,
        hostId: environment.hostId,
      };
    }
    if (source.projectId) {
      const hostId = source.hostId ?? (await this.bb.sdk.system.config()).primaryHostId;
      if (!hostId) throw new Error("This bb has no server machine yet");
      const project = await this.bb.sdk.projects.get({ projectId: source.projectId });
      const sources = project.sources.filter((candidate) => candidate.hostId === hostId);
      const [workspace] = sources;
      if (!workspace) {
        throw new Error(
          source.hostId
            ? "This project has no workspace on the selected host"
            : "This project has no workspace on the server machine",
        );
      }
      if (sources.length > 1) {
        throw new Error("This project has multiple workspaces on that host");
      }
      if (!isAbsolute(workspace.path)) {
        throw new Error("This project has no absolute workspace path");
      }
      return {
        path: joinPosix(workspace.path, path),
        rootPath: workspace.path,
        hostId,
      };
    }
    throw new Error("Workspace files need an environment or project");
  }

  async read(source: FileSourceJson, path: string): Promise<WorkspaceFile> {
    const target = await this.resolve(source, path);
    const file = await this.bb.sdk.files.read({
      ...(target.hostId ? { hostId: target.hostId } : {}),
      path: target.path,
      ...(target.rootPath ? { rootPath: target.rootPath } : {}),
    });
    // No conditional-read is ever sent, so the full variant always arrives.
    if (!("content" in file) || file.contentEncoding !== "utf8") {
      throw new Error("This file is not UTF-8 text; the editor cannot open it");
    }
    return {
      content: file.content,
      sha256: file.sha256,
      modifiedAtMs: file.modifiedAtMs ?? null,
    };
  }

  async write(
    source: FileSourceJson,
    path: string,
    content: string,
    expectedSha256?: string,
  ): Promise<WorkspaceWriteOutcome> {
    const target = await this.resolve(source, path);
    const result = await this.bb.sdk.files.write({
      ...(target.hostId ? { hostId: target.hostId } : {}),
      path: target.path,
      ...(target.rootPath ? { rootPath: target.rootPath } : {}),
      content,
      createParents: true,
      ...(expectedSha256 === undefined ? {} : { expectedSha256 }),
    });
    if (result.outcome === "conflict") {
      return { outcome: "conflict", currentSha256: result.currentSha256 };
    }
    return { outcome: "written", sha256: result.sha256 };
  }
}

function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(path);
}

/** Expands a leading `~` the way the docs plugin does before host-file calls. */
function expandHome(path: string): string {
  if (path === "~") return process.env.HOME ?? path;
  if (path.startsWith("~/")) return `${process.env.HOME ?? ""}${path.slice(1)}`;
  return path;
}

/** POSIX join that never escapes the root (paths are vault-relative). */
function joinPosix(root: string, relative: string): string {
  const clean = relative.replaceAll("\\", "/").replace(/^\/+/, "");
  const rootClean = root.replace(/\/+$/, "");
  if (clean.split("/").some((segment) => segment === "..")) {
    throw new Error("Path escapes its root");
  }
  return `${rootClean}/${clean}`;
}
