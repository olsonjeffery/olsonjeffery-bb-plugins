// bb-plugin-drawio — contract vocabulary: vault path rules, draft keys, tab
// params, and the panel subPath codec round-trips.
import { describe, expect, it } from "vitest";
import {
  fileDraftKey,
  isValidVaultPath,
  STARTER_XML,
  UNTITLED_PREFIX,
  vaultDraftKey,
} from "./contract.js";
import {
  draftToSubPath,
  embedOrigin,
  embedUrl,
  parseSubPath,
  parseTabParams,
  refToSubPath,
  docTitle,
  exportFilename,
} from "./app/drawio.js";

describe("vault path rules", () => {
  it("accepts ordinary relative paths", () => {
    expect(isValidVaultPath("diagrams/architecture.drawio")).toBe(true);
    expect(isValidVaultPath("a/b/c.drawio")).toBe(true);
    expect(isValidVaultPath("2024 Q3 plan.drawio")).toBe(true);
  });

  it("rejects traversal, absolutes, dot segments, and empties", () => {
    expect(isValidVaultPath("/etc/passwd")).toBe(false);
    expect(isValidVaultPath("../escape.drawio")).toBe(false);
    expect(isValidVaultPath("diagrams/../escape.drawio")).toBe(false);
    expect(isValidVaultPath("")).toBe(false);
    expect(isValidVaultPath("a//b.drawio")).toBe(false);
    expect(isValidVaultPath("a/./b.drawio")).toBe(false);
    expect(isValidVaultPath(".hidden.drawio")).toBe(false);
    expect(isValidVaultPath("folder/.hidden.drawio")).toBe(false);
    expect(isValidVaultPath("back\\slash.drawio")).toBe(false);
  });
});

describe("draft keys", () => {
  it("namespaces by document identity", () => {
    expect(vaultDraftKey("v1", "diagrams/a.drawio")).toBe("vault:v1:diagrams/a.drawio");
    const source = {
      kind: "workspace",
      threadId: null,
      environmentId: "env1",
      projectId: null,
    } as const;
    expect(fileDraftKey(source, "app/flow.drawio")).toBe("file:workspace||env1||:app/flow.drawio");
  });
});

describe("tab params", () => {
  it("round-trips every ref kind", () => {
    const vaultRef = { kind: "vault", vaultId: "v1", path: "diagrams/a.drawio" } as const;
    expect(parseTabParams(vaultRef)).toEqual(vaultRef);

    const fileRef = {
      kind: "file",
      source: { kind: "host", threadId: null, environmentId: null, projectId: null, hostId: "h1" },
      path: "/home/me/diagram.drawio",
    } as const;
    expect(parseTabParams(fileRef)).toEqual(fileRef);

    expect(parseTabParams({ kind: "home" })).toEqual({ kind: "home" });
    expect(parseTabParams({ kind: "draft", draftKey: "untitled:abc" })).toEqual({
      kind: "draft",
      draftKey: "untitled:abc",
    });
  });

  it("rejects malformed params", () => {
    expect(parseTabParams(null)).toBeNull();
    expect(parseTabParams({})).toBeNull();
    expect(parseTabParams({ kind: "vault", vaultId: "", path: "x.drawio" })).toBeNull();
    expect(parseTabParams({ kind: "file", source: { kind: "nope" }, path: "x" })).toBeNull();
  });
});

describe("subPath codec", () => {
  it("round-trips a vault ref through the panel route", () => {
    const ref = { kind: "vault", vaultId: "personal", path: "diagrams/my ideas.drawio" } as const;
    const parsed = parseSubPath(refToSubPath(ref));
    expect(parsed.ref).toEqual(ref);
  });

  it("round-trips a file ref with its source", () => {
    const ref = {
      kind: "file",
      source: { kind: "workspace", threadId: null, environmentId: "env1", projectId: null },
      path: "src/flows/main.drawio",
    } as const;
    const parsed = parseSubPath(refToSubPath(ref));
    expect(parsed.ref).toEqual(ref);
  });

  it("round-trips a draft ref", () => {
    const key = `${UNTITLED_PREFIX}abc123`;
    const parsed = parseSubPath(draftToSubPath(key));
    expect(parsed.ref).toEqual({ kind: "draft", draftKey: key });
  });

  it("survives the route's own percent-encoding (no double encoding)", () => {
    // toPluginPanel takes unencoded segments and encodes them; the panel
    // receives the percent-encoded URL form. A pre-encoded ref used to
    // double-encode (space → %20 → %2520) and look for a file literally
    // named `Untitled%20diagram.drawio`.
    const ref = { kind: "vault", vaultId: "personal", path: "diagrams/Untitled diagram.drawio" } as const;
    const encoded = refToSubPath(ref)
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    expect(encoded).toContain("Untitled%20diagram.drawio");
    expect(parseSubPath(encoded).ref).toEqual(ref);
  });

  it("degrades unknown subPaths to home", () => {
    expect(parseSubPath("").ref).toBeNull();
    expect(parseSubPath("nonsense").ref).toBeNull();
    expect(parseSubPath("open/vault/v1").ref).toBeNull();
    expect(parseSubPath("open/draft/%%%").ref).toBeNull();
  });
});

describe("export helpers", () => {
  it("names exports after the document", () => {
    expect(exportFilename("my diagram.drawio", "png")).toBe("my diagram.png");
    expect(exportFilename("my diagram.drawio", "xmlpng")).toBe("my diagram.png");
    expect(exportFilename("my diagram.drawio", "xml")).toBe("my diagram.xml");
  });

  it("titles docs by their last path segment", () => {
    expect(docTitle({ kind: "vault", vaultId: "v", path: "a/b/c.drawio" })).toBe("c.drawio");
  });
});

describe("embed config", () => {
  it("builds the embed URL with the JSON protocol and resolves the origin", () => {
    const url = embedUrl({ instanceUrl: "http://localhost:8080/drawio/", uiTheme: "sketch" });
    expect(url).not.toBeNull();
    const parsed = new URL(url ?? "");
    expect(parsed.origin).toBe("http://localhost:8080");
    expect(parsed.searchParams.get("embed")).toBe("1");
    expect(parsed.searchParams.get("proto")).toBe("json");
    expect(parsed.searchParams.get("ui")).toBe("sketch");
    expect(embedOrigin("https://draw.example.com")).toBe("https://draw.example.com");
  });

  it("returns null for unset or invalid URLs", () => {
    expect(embedUrl({ instanceUrl: "", uiTheme: "min" })).toBeNull();
    expect(embedUrl({ instanceUrl: "not a url", uiTheme: "min" })).toBeNull();
    expect(embedOrigin("")).toBeNull();
  });

});

describe("starter xml", () => {
  it("is a complete mxfile the editor accepts", () => {
    expect(STARTER_XML).toContain("<mxfile");
    expect(STARTER_XML).toContain("</mxfile>");
    expect(STARTER_XML).toContain("<mxGraphModel");
  });
});
