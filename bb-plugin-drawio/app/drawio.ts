// bb-plugin-drawio — frontend helpers shared by every surface: the embed URL,
// the subPath codec for the panel route, tab-param codecs, and export plumbing.
import type { DiagramTabParams, DocRef, FileSourceJson } from "../contract.js";

export const PANEL_PATH = "diagrams";

// ---------------------------------------------------------------------------
// Embed URL
// ---------------------------------------------------------------------------

export interface EmbedConfig {
  instanceUrl: string;
  uiTheme: "min" | "sketch" | "atlas";
}

/** The iframe URL: embed mode with the JSON postMessage protocol. */
export function embedUrl({ instanceUrl, uiTheme }: EmbedConfig): string | null {
  const trimmed = instanceUrl.trim();
  if (trimmed === "") return null;
  try {
    const url = new URL(trimmed);
    url.searchParams.set("embed", "1");
    url.searchParams.set("proto", "json");
    url.searchParams.set("spin", "1");
    url.searchParams.set("libraries", "1");
    url.searchParams.set("ui", uiTheme);
    return url.toString();
  } catch {
    return null;
  }
}

/** The origin every inbound postMessage must carry. */
export function embedOrigin(instanceUrl: string): string | null {
  try {
    return new URL(instanceUrl.trim()).origin;
  } catch {
    return null;
  }
}

/**
 * https app page + http instance = browser mixed-content: the iframe silently
 * refuses to load. Detect it so the UI can say why the page is blank.
 */
export function isMixedContent(instanceUrl: string): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.protocol !== "https:") return false;
  const url = embedUrl({ instanceUrl, uiTheme: "min" });
  return url !== null && url.startsWith("http://");
}

// ---------------------------------------------------------------------------
// Tab params ⇄ JSON (persisted by bb)
// ---------------------------------------------------------------------------

export function parseTabParams(raw: unknown): DiagramTabParams | null {
  if (raw === null || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  switch (value.kind) {
    case "home":
      return { kind: "home" };
    case "draft":
      return typeof value.draftKey === "string" && value.draftKey !== ""
        ? { kind: "draft", draftKey: value.draftKey }
        : null;
    case "vault":
      return typeof value.vaultId === "string" &&
        value.vaultId !== "" &&
        typeof value.path === "string" &&
        value.path !== ""
        ? { kind: "vault", vaultId: value.vaultId, path: value.path }
        : null;
    case "file":
      return isFileSourceJson(value.source) && typeof value.path === "string" && value.path !== ""
        ? { kind: "file", source: normalizeSource(value.source), path: value.path }
        : null;
    default:
      return null;
  }
}

export function isFileSourceJson(value: unknown): value is FileSourceJson {
  if (value === null || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return (
    (source.kind === "workspace" || source.kind === "host" || source.kind === "thread-storage") &&
    ("threadId" in source || "environmentId" in source || "projectId" in source)
  );
}

/** Drops empty scope fields so persisted tab params stay canonical. */
export function normalizeSource(source: FileSourceJson): FileSourceJson {
  return {
    kind: source.kind,
    threadId: source.threadId,
    environmentId: source.environmentId,
    projectId: source.projectId,
    ...(typeof (source as { hostId?: unknown }).hostId === "string"
      ? { hostId: (source as { hostId: string }).hostId }
      : {}),
  };
}

/** A short, human-safe tab title for a doc. */
export function docTitle(ref: DocRef): string {
  return ref.path.split("/").pop() ?? ref.path;
}

// ---------------------------------------------------------------------------
// subPath codec for the panel route (body deep links)
// ---------------------------------------------------------------------------

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): string | null {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** subPath for a doc ref: `open/vault/<id>/<segments>` / `open/file/<b64>/<segments>`. */
export function refToSubPath(ref: DocRef): string {
  const segments = ref.path.split("/").map((segment) => encodeURIComponent(segment));
  if (ref.kind === "vault") {
    return ["open", "vault", encodeURIComponent(ref.vaultId), ...segments].join("/");
  }
  return ["open", "file", encodeBase64Url(JSON.stringify(ref.source)), ...segments].join("/");
}

export function draftToSubPath(draftKey: string): string {
  return `open/draft/${encodeBase64Url(draftKey)}`;
}

export interface ParsedSubPath {
  ref: DocRef | { kind: "draft"; draftKey: string } | null;
}

/**
 * Parses the panel route remainder. Every segment is percent-decoded; a
 * malformed link degrades to the home view rather than an error page.
 */
export function parseSubPath(rawSubPath: string): ParsedSubPath {
  const raw = rawSubPath.replace(/^\/+/, "");
  if (raw === "") return { ref: null };
  const segments = raw.split("/").map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  if (segments[0] !== "open") return { ref: null };

  if (segments[1] === "vault" && segments.length >= 4) {
    const [open, kind, vaultId, ...pathSegments] = segments;
    const path = pathSegments.join("/");
    if (open === "open" && kind === "vault" && vaultId !== "" && path !== "") {
      return { ref: { kind: "vault", vaultId, path } };
    }
    return { ref: null };
  }

  if (segments[1] === "file" && segments.length >= 4) {
    const [, , encodedSource, ...pathSegments] = segments;
    const path = pathSegments.join("/");
    const decoded = decodeBase64Url(encodedSource ?? "");
    const source = decoded === null ? null : (JSON.parse(decoded) as unknown);
    if (isFileSourceJson(source) && path !== "") {
      return { ref: { kind: "file", source: normalizeSource(source), path } };
    }
    return { ref: null };
  }

  if (segments[1] === "draft" && segments.length === 3) {
    const draftKey = decodeBase64Url(segments[2] ?? "");
    if (draftKey) return { ref: { kind: "draft", draftKey } };
    return { ref: null };
  }

  return { ref: null };
}

// ---------------------------------------------------------------------------
// Export plumbing
// ---------------------------------------------------------------------------

export interface ExportResult {
  /** data URI for binary formats, present for png/jpeg/svg/pdf/xmlpng. */
  dataUri: string | null;
  /** Raw XML for format "xml". */
  xml: string | null;
}

export function exportFilename(docName: string, format: ExportFormat): string {
  const base = docName.replace(/\.[^.]+$/, "") || "diagram";
  return `${base}.${format === "xmlpng" ? "png" : format}`;
}

export type ExportFormat = "png" | "jpeg" | "svg" | "pdf" | "xml" | "xmlpng";

/** Triggers a browser download for a data URI or raw text payload. */
export function downloadExport(result: ExportResult, filename: string): void {
  let href: string;
  if (result.dataUri !== null) {
    href = result.dataUri;
  } else if (result.xml !== null) {
    href = URL.createObjectURL(new Blob([result.xml], { type: "application/xml" }));
  } else {
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (href.startsWith("blob:")) {
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }
}

/** Decodes a base64 data URI into bytes (PNG copy-to-clipboard). */
export function dataUriToBytes(dataUri: string): Uint8Array | null {
  const match = /^data:[^;,]*;base64,(.*)$/s.exec(dataUri);
  if (!match) return null;
  const binary = atob(match[1] ?? "");
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
