// bb-plugin-drawio — plugin-owned SQLite.
//
// Two tenants share this database:
//
//   drafts      — the work-saving net: the newest editor XML for every open
//                 document, written on a debounce so an accidental close
//                 never loses a diagram. Discarded on a successful real save.
//   vault_files — the .drawio discovery cache. The docs plugin's snapshot RPC
//                 returns every vault file with its content, which is far too
//                 heavy to pay per sidebar render, so the .drawio entries are
//                 landed here once per vault (or on an explicit refresh) and
//                 maintained incrementally on our own writes.
import type { VaultFileEntry } from "./contract.js";

export interface DraftRow {
  key: string;
  content: string;
  params: string | null;
  updatedAt: number;
}

export class Store {
  constructor(private readonly db: import("better-sqlite3").Database) {}

  private draftStatements() {
    const db = this.db;
    return {
      get: db.prepare("SELECT key, content, params, updated_at FROM drafts WHERE key = ?"),
      list: db.prepare("SELECT key, content, params, updated_at FROM drafts ORDER BY updated_at DESC LIMIT 100"),
      put: db.prepare(
        `INSERT INTO drafts (key, content, params, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET content = excluded.content, params = excluded.params, updated_at = excluded.updated_at`,
      ),
      discard: db.prepare("DELETE FROM drafts WHERE key = ?"),
    };
  }

  private vaultStatements() {
    const db = this.db;
    return {
      list: db.prepare(
        "SELECT path, sha256, size_bytes, modified_at_ms FROM vault_files WHERE vault_id = ? ORDER BY path",
      ),
      put: db.prepare(
        `INSERT INTO vault_files (vault_id, path, sha256, size_bytes, modified_at_ms) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(vault_id, path) DO UPDATE SET sha256 = excluded.sha256, size_bytes = excluded.size_bytes, modified_at_ms = excluded.modified_at_ms`,
      ),
      remove: db.prepare("DELETE FROM vault_files WHERE vault_id = ? AND path = ?"),
      removeVault: db.prepare("DELETE FROM vault_files WHERE vault_id = ?"),
      get: db.prepare("SELECT sha256, size_bytes FROM vault_files WHERE vault_id = ? AND path = ?"),
      syncGet: db.prepare("SELECT refreshed_at_ms FROM vault_sync WHERE vault_id = ?"),
      syncSet: db.prepare(
        `INSERT INTO vault_sync (vault_id, refreshed_at_ms) VALUES (?, ?)
         ON CONFLICT(vault_id) DO UPDATE SET refreshed_at_ms = excluded.refreshed_at_ms`,
      ),
    };
  }

  // --- drafts --------------------------------------------------------------

  getDraft(key: string): DraftRow | null {
    const row = this.draftStatements().get.get(key) as
      | { key: string; content: string; params: string | null; updated_at: number }
      | undefined;
    return row ? { key: row.key, content: row.content, params: row.params, updatedAt: row.updated_at } : null;
  }

  listDrafts(): DraftRow[] {
    return (this.draftStatements().list.all() as Array<{
      key: string;
      content: string;
      params: string | null;
      updated_at: number;
    }>).map((row) => ({ key: row.key, content: row.content, params: row.params, updatedAt: row.updated_at }));
  }

  putDraft(key: string, content: string, params: string | null, now: number): number {
    this.draftStatements().put.run(key, content, params, now);
    return now;
  }

  discardDraft(key: string): void {
    this.draftStatements().discard.run(key);
  }

  // --- vault cache ---------------------------------------------------------

  vaultFiles(vaultId: string): VaultFileEntry[] {
    return (this.vaultStatements().list.all(vaultId) as Array<{
      path: string;
      sha256: string;
      size_bytes: number;
      modified_at_ms: number;
    }>).map((row) => ({
      path: row.path,
      sha256: row.sha256,
      sizeBytes: row.size_bytes,
      modifiedAtMs: row.modified_at_ms,
    }));
  }

  /** When this vault's cache was last refreshed from a full snapshot; null = never. */
  vaultSyncedAt(vaultId: string): number | null {
    const row = this.vaultStatements().syncGet.get(vaultId) as
      | { refreshed_at_ms: number }
      | undefined;
    return row ? row.refreshed_at_ms : null;
  }

  /** Lands one full snapshot of .drawio entries, replacing everything stale. */
  syncVault(vaultId: string, entries: VaultFileEntry[], now: number): void {
    const stmts = this.vaultStatements();
    const replace = this.db.transaction((rows: VaultFileEntry[]) => {
      stmts.removeVault.run(vaultId);
      for (const row of rows) {
        stmts.put.run(vaultId, row.path, row.sha256, row.sizeBytes, row.modifiedAtMs);
      }
      stmts.syncSet.run(vaultId, now);
    });
    replace(entries);
  }

  /** Incremental: our own write of one path. */
  noteVaultWrite(vaultId: string, path: string, sha256: string, sizeBytes: number, now: number): void {
    this.vaultStatements().put.run(vaultId, path, sha256, sizeBytes, now);
  }

  noteVaultRemove(vaultId: string, path: string): void {
    this.vaultStatements().remove.run(vaultId, path);
  }

  noteVaultMove(vaultId: string, from: string, to: string, now: number): void {
    const existing = this.vaultStatements().get.get(vaultId, from) as
      | { sha256: string; size_bytes: number }
      | undefined;
    const tx = this.db.transaction(() => {
      this.noteVaultRemove(vaultId, from);
      if (existing) {
        this.noteVaultWrite(vaultId, to, existing.sha256, existing.size_bytes, now);
      }
    });
    tx();
  }
}

/** The schema this plugin ships with; statement index = migration id. */
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS drafts (
     key        TEXT PRIMARY KEY,
     content    TEXT NOT NULL,
     params     TEXT,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS vault_files (
     vault_id       TEXT NOT NULL,
     path           TEXT NOT NULL,
     sha256         TEXT NOT NULL,
     size_bytes     INTEGER NOT NULL,
     modified_at_ms INTEGER NOT NULL,
     PRIMARY KEY (vault_id, path)
   )`,
  `CREATE TABLE IF NOT EXISTS vault_sync (
     vault_id        TEXT PRIMARY KEY,
     refreshed_at_ms INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS drafts_updated_at ON drafts(updated_at)`,
];
