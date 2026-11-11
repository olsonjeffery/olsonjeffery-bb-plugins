// bb-plugin-drawio — the DocumentSource model.
//
// One interface over the three places a diagram can live — a Docs-vault file,
// a workspace/host file, or a plugin draft — so every surface (panel body,
// action tabs, the fileOpener) mounts the same editor component. The
// implementation is thin RPC over the plugin's own backend contract; all CAS
// bookkeeping happens server-side.
import { useCallback, useEffect, useRef } from "react";
import type { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract.js";
import {
  UNTITLED_PREFIX,
  fileDraftKey,
  vaultDraftKey,
} from "../contract.js";
import type { DocRef, FileSourceJson } from "../contract.js";
import { docTitle } from "./drawio.js";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

export interface LoadedDoc {
  content: string;
  sha256: string | null;
  modifiedAtMs: number | null;
  /** Stable draft key for this document (recovery + autosave net). */
  draftKey: string;
  /** True when the doc is a never-saved untitled draft. */
  untitled: boolean;
}

export interface SourceAdapter {
  readonly ref: DocRef | { kind: "draft"; draftKey: string };
  readonly untitled: boolean;
  readonly draftKey: string;
  title(): string;
  load(rpc: Rpc): Promise<LoadedDoc>;
  save(rpc: Rpc, content: string, expectedSha256: string | null): Promise<SaveResult>;
}

export type SaveResult =
  | { outcome: "written"; sha256: string }
  | { outcome: "conflict"; currentSha256: string | null };

export function sourceFor(
  ref: DocRef | { kind: "draft"; draftKey: string },
): SourceAdapter {
  if (ref.kind === "draft") {
    return new DraftSource(ref.draftKey);
  }
  if (ref.kind === "vault") {
    return new VaultSource(ref.vaultId, ref.path);
  }
  return new FileSource(ref.source, ref.path);
}

// ---------------------------------------------------------------------------

class VaultSource implements SourceAdapter {
  readonly ref: DocRef;
  readonly untitled = false;

  constructor(
    private readonly vaultId: string,
    private readonly path: string,
  ) {
    this.ref = { kind: "vault", vaultId, path };
  }

  get draftKey(): string {
    return vaultDraftKey(this.vaultId, this.path);
  }

  title(): string {
    return docTitle(this.ref);
  }

  async load(rpc: Rpc): Promise<LoadedDoc> {
    const file = await rpc.call("vault.read", { vaultId: this.vaultId, path: this.path });
    return {
      content: file.content,
      sha256: file.sha256,
      modifiedAtMs: file.modifiedAtMs,
      draftKey: this.draftKey,
      untitled: false,
    };
  }

  async save(rpc: Rpc, content: string, expectedSha256: string | null): Promise<SaveResult> {
    return rpc.call("vault.write", {
      vaultId: this.vaultId,
      path: this.path,
      content,
      ...(expectedSha256 === null ? {} : { expectedSha256 }),
    });
  }
}

class FileSource implements SourceAdapter {
  readonly ref: DocRef;
  readonly untitled = false;

  constructor(
    private readonly source: FileSourceJson,
    private readonly path: string,
  ) {
    this.ref = { kind: "file", source, path };
  }

  get draftKey(): string {
    return fileDraftKey(this.source, this.path);
  }

  title(): string {
    return docTitle(this.ref);
  }

  async load(rpc: Rpc): Promise<LoadedDoc> {
    const file = await rpc.call("workspace.read", { source: this.source, path: this.path });
    return {
      content: file.content,
      sha256: file.sha256,
      modifiedAtMs: file.modifiedAtMs,
      draftKey: this.draftKey,
      untitled: false,
    };
  }

  async save(rpc: Rpc, content: string, expectedSha256: string | null): Promise<SaveResult> {
    return rpc.call("workspace.write", {
      source: this.source,
      path: this.path,
      content,
      ...(expectedSha256 === null ? {} : { expectedSha256 }),
    });
  }
}

/** A never-saved diagram. Its draft row IS the storage until Save As. */
class DraftSource implements SourceAdapter {
  readonly untitled = true;

  constructor(readonly draftKey: string) {
    if (!draftKey.startsWith(UNTITLED_PREFIX)) {
      throw new Error("DraftSource is only for untitled diagrams");
    }
  }

  get ref(): { kind: "draft"; draftKey: string } {
    return { kind: "draft", draftKey: this.draftKey };
  }

  title(): string {
    return "Untitled diagram";
  }

  async load(rpc: Rpc): Promise<LoadedDoc> {
    const { draft } = await rpc.call("drafts.get", { key: this.draftKey });
    return {
      content: draft?.content ?? "",
      sha256: null,
      modifiedAtMs: draft?.updatedAt ?? null,
      draftKey: this.draftKey,
      untitled: true,
    };
  }

  async save(rpc: Rpc, content: string): Promise<SaveResult> {
    const { updatedAt } = await rpc.call("drafts.put", { key: this.draftKey, content });
    return { outcome: "written", sha256: `draft:${updatedAt}` };
  }
}

// ---------------------------------------------------------------------------
// Draft persistence helpers shared by every editor surface
// ---------------------------------------------------------------------------

/**
 * The unsaved-work net: 3s after the last keystroke of a dirty diagram the
 * current XML lands in the drafts table, and a dirty diagram flushes once on
 * unmount — so closing a tab, navigating away, or a reload can cost at most
 * the last three seconds of strokes, never the diagram. Best-effort by
 * design; a failed draft put must never interrupt editing.
 */
export function useDraftAutosave(
  rpc: Rpc,
  draftKey: string | null,
  xml: string,
  dirty: boolean,
): void {
  const put = useCallback(
    (content: string) => {
      if (draftKey === null) return;
      void rpc
        .call("drafts.put", { key: draftKey, content })
        .catch(() => undefined);
    },
    [rpc, draftKey],
  );

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const xmlRef = useRef(xml);
  xmlRef.current = xml;
  const putRef = useRef(put);
  putRef.current = put;

  // Debounce while editing.
  useEffect(() => {
    if (!dirty || draftKey === null) return;
    const timer = setTimeout(() => put(xml), 3000);
    return () => clearTimeout(timer);
  }, [dirty, xml, draftKey, put]);

  // Flush on unmount — the accidental-close path the net exists for.
  useEffect(
    () => () => {
      if (dirtyRef.current) putRef.current(xmlRef.current);
    },
    [],
  );
}
