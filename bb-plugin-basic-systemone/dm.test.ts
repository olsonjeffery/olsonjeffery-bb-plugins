// dm.test.ts — the decision-model library's failure-prone policy: the gate,
// request preparation, endpoint URLs, HTTP error mapping, and listing
// normalization. HTTP paths run against an injected fetch and real Response
// objects, so the production code path is the one under test.

import { describe, expect, it } from "vitest";
import {
  DmError,
  endpointUrl,
  listDecisionModels,
  normalizeModelList,
  postDecisionRequest,
  prepareRequest,
  resolveDesignation,
  emptyDecisionSettings,
} from "./dm.js";

describe("resolveDesignation", () => {
  it("stays disabled without a provider", () => {
    const status = resolveDesignation(emptyDecisionSettings());
    expect(status).toEqual({ enabled: false, reason: "no-provider" });
  });

  it("stays disabled without a model", () => {
    const status = resolveDesignation({ ...emptyDecisionSettings(), providerId: "liquid" });
    expect(status).toEqual({ enabled: false, reason: "no-model" });
  });

  it("enables with a provider and model, preferring the override base", () => {
    const status = resolveDesignation(
      { ...emptyDecisionSettings(), providerId: "liquid", modelId: "d1.2", baseUrl: "http://127.0.0.1:1" },
      "https://api.liquid.ai/decisions",
    );
    expect(status).toEqual({
      enabled: true,
      designation: expect.objectContaining({
        providerId: "liquid",
        modelId: "d1.2",
        baseUrl: "http://127.0.0.1:1",
        baseUrlSource: "override",
      }),
    });
  });

  it("falls back to the profile base when no override is set", () => {
    const status = resolveDesignation(
      { ...emptyDecisionSettings(), providerId: "liquid", modelId: "d1.2" },
      "https://api.liquid.ai/decisions",
    );
    if (!status.enabled) throw new Error("expected enabled");
    expect(status.designation.baseUrl).toBe("https://api.liquid.ai/decisions");
    expect(status.designation.baseUrlSource).toBe("profile");
  });
});

describe("prepareRequest", () => {
  const model = "d1.2";

  it("fills in model when the payload omits it and forwards the rest untouched", () => {
    const payload = { state: "hello", questions: { a: { type: "noul" } } };
    const request = prepareRequest(payload, model);
    expect(request).toEqual({
      model: "d1.2",
      state: "hello",
      questions: { a: { type: "noul" } },
    });
  });

  it("keeps the payload's own model authoritative", () => {
    const request = prepareRequest(
      { model: "other-model", questions: { a: { type: "noul" } } },
      model,
    );
    expect(request["model"]).toBe("other-model");
  });

  it("accepts null state and image arrays", () => {
    const request = prepareRequest(
      {
        state: null,
        images: ["data:image/png;base64,AAA", { content_type: "image/png", base64: "AAA" }],
        questions: { q: { type: "noul" } },
      },
      model,
    );
    expect(Array.isArray(request["images"])).toBe(true);
  });

  it("rejects non-object payloads", () => {
    expect(() => prepareRequest("[]", model)).toThrow(DmError);
    expect(() => prepareRequest(null, model)).toThrow(
      expect.objectContaining({ code: "invalid_payload" }),
    );
    expect(() => prepareRequest([1], model)).toThrow(DmError);
  });

  it("rejects missing, non-object, or empty questions", () => {
    expect(() => prepareRequest({ model }, model)).toThrow(
      expect.objectContaining({ code: "invalid_payload" }),
    );
    expect(() => prepareRequest({ questions: [] }, model)).toThrow(DmError);
    expect(() => prepareRequest({ questions: {} }, model)).toThrow(DmError);
  });

  it("rejects non-object questions and non-array images", () => {
    expect(() => prepareRequest({ questions: { a: "noul" } }, model)).toThrow(
      expect.objectContaining({ code: "invalid_payload" }),
    );
    expect(() => prepareRequest({ questions: { a: { type: "noul" } }, images: {} }, model)).toThrow(
      DmError,
    );
  });
});

describe("endpointUrl", () => {
  it("joins the request path after trimming trailing slashes", () => {
    expect(endpointUrl("https://api.liquid.ai/decisions", "/v1/systemone")).toBe(
      "https://api.liquid.ai/decisions/v1/systemone",
    );
    expect(endpointUrl("http://127.0.0.1:9931/", "/v1/systemone")).toBe(
      "http://127.0.0.1:9931/v1/systemone",
    );
  });

  it("throws endpoint_unresolved when the base is empty", () => {
    expect(() => endpointUrl("", "/v1/systemone")).toThrow(
      expect.objectContaining({ code: "endpoint_unresolved" }),
    );
  });

  it("rejects invalid URLs and non-http protocols", () => {
    expect(() => endpointUrl("not a url", "/v1/systemone")).toThrow(
      expect.objectContaining({ code: "invalid_value" }),
    );
    expect(() => endpointUrl("ftp://x", "/v1/systemone")).toThrow(
      expect.objectContaining({ code: "invalid_value" }),
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

function fetchReturning(build: (init: RequestInit) => Promise<Response> | Response): typeof fetch {
  return (async (url: unknown, init: RequestInit = {}) => build(init)) as unknown as typeof fetch;
}

const REQUEST_URL = "https://api.liquid.ai/decisions/v1/systemone";
const REQUEST = { model: "d1.2", state: "hi", questions: { a: { type: "noul" } } };
const RESPONSE = {
  model: "d1.2",
  answers: { a: { type: "noul", noul: 0.9 } },
  usage: { input_tokens: 10, output_tokens: 0 },
};

describe("postDecisionRequest", () => {
  it("posts JSON with content-type and echoes the parsed response", async () => {
    let seenBody: string | undefined;
    let seenAuth: string | undefined;
    const result = await postDecisionRequest({
      url: REQUEST_URL,
      request: REQUEST,
      apiKey: "k",
      fetchImpl: fetchReturning((init) => {
        seenBody = String(init.body);
        seenAuth = String(new Headers(init.headers).get("authorization"));
        return jsonResponse(RESPONSE);
      }),
    });
    expect(result).toEqual({ status: 200, json: RESPONSE });
    expect(JSON.parse(seenBody ?? "")).toEqual(REQUEST);
    expect(seenAuth).toBe("Bearer k");
  });

  it("omits the authorization header when no key is set", async () => {
    let seenAuth: string | null = null;
    await postDecisionRequest({
      url: REQUEST_URL,
      request: REQUEST,
      fetchImpl: fetchReturning((init) => {
        seenAuth = new Headers(init.headers).get("authorization");
        return jsonResponse(RESPONSE);
      }),
    });
    expect(seenAuth).toBeNull();
  });

  it("maps 401 to auth_failed with a key hint", async () => {
    await expect(
      postDecisionRequest({
        url: REQUEST_URL,
        request: REQUEST,
        fetchImpl: () => textResponse("unauthorized", 401),
      }),
    ).rejects.toMatchObject({ code: "auth_failed" });
  });

  it("maps 422 to invalid_request carrying the upstream detail", async () => {
    await expect(
      postDecisionRequest({
        url: REQUEST_URL,
        request: REQUEST,
        fetchImpl: () => jsonResponse({ detail: "bad criteria" }, 422),
      }),
    ).rejects.toMatchObject({ code: "invalid_request", message: expect.stringContaining("bad criteria") });
  });

  it("maps 429 to rate_limited and 5xx to upstream_error", async () => {
    await expect(
      postDecisionRequest({
        url: REQUEST_URL,
        request: REQUEST,
        fetchImpl: () => textResponse("slow down", 429),
      }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    await expect(
      postDecisionRequest({
        url: REQUEST_URL,
        request: REQUEST,
        fetchImpl: () => textResponse("boom", 500),
      }),
    ).rejects.toMatchObject({ code: "upstream_error" });
  });

  it("reports bad_response when a 200 is not JSON", async () => {
    await expect(
      postDecisionRequest({
        url: REQUEST_URL,
        request: REQUEST,
        fetchImpl: () => textResponse("<html>nope</html>", 200),
      }),
    ).rejects.toMatchObject({ code: "bad_response" });
  });

  it("reports network_error when the endpoint is unreachable", async () => {
    await expect(
      postDecisionRequest({
        url: "http://127.0.0.1:1/v1/systemone",
        request: REQUEST,
        fetchImpl: () => Promise.reject(new TypeError("fetch failed")),
      }),
    ).rejects.toMatchObject({ code: "network_error" });
  });

  it("reports timeout when the endpoint never answers", async () => {
    const fetchImpl = ((url: unknown, init: RequestInit = {}) => {
      return new Promise<Response>((_resolve, reject) => {
        if (init.signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }) as unknown as typeof fetch;
    await expect(
      postDecisionRequest({
        url: REQUEST_URL,
        request: REQUEST,
        timeoutMs: 30,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("reports cancelled when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = ((url: unknown, init: RequestInit = {}) => {
      return new Promise<Response>((_resolve, reject) => {
        if (init.signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }) as unknown as typeof fetch;
    await expect(
      postDecisionRequest({
        url: REQUEST_URL,
        request: REQUEST,
        signal: controller.signal,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("listDecisionModels + normalizeModelList", () => {
  it("normalizes the Liquid listing shape", () => {
    const models = normalizeModelList({
      models: [
        {
          name: "d1.2",
          description: "The default decision model.",
          release_date: "2026-09-22",
          input_modalities: ["text", "image"],
        },
        { name: "d1.2-ultra" },
        "garbage-entry-is-skipped",
      ],
    });
    expect(models).toEqual([
      {
        id: "d1.2",
        description: "The default decision model.",
        releaseDate: "2026-09-22",
        inputModalities: ["text", "image"],
      },
      { id: "d1.2-ultra", description: null, releaseDate: null, inputModalities: null },
    ]);
  });

  it("normalizes OpenAI-compatible listings (llama serve)", () => {
    const models = normalizeModelList({ object: "list", data: [{ id: "d1-2b" }, { id: "d1-omni" }] });
    expect(models.map((model) => model.id)).toEqual(["d1-2b", "d1-omni"]);
  });

  it("throws bad_response on unexpected shapes", () => {
    expect(() => normalizeModelList({ nope: true })).toThrow(
      expect.objectContaining({ code: "bad_response" }),
    );
  });

  it("sends the bearer key to the listing endpoint and maps 401", async () => {
    let seenAuth: string | null = null;
    await expect(
      listDecisionModels({
        url: "https://api.liquid.ai/decisions/v1/models",
        apiKey: "k",
        fetchImpl: fetchReturning((init) => {
          seenAuth = new Headers(init.headers).get("authorization");
          return textResponse("nope", 401);
        }),
      }),
    ).rejects.toMatchObject({ code: "auth_failed" });
    expect(seenAuth).toBe("Bearer k");
  });

  it("returns normalized models from a live-shaped listing", async () => {
    const models = await listDecisionModels({
      url: "http://127.0.0.1:9931/v1/models",
      fetchImpl: () => jsonResponse({ object: "list", data: [{ id: "d1-2b" }] }),
    });
    expect(models.map((model) => model.id)).toEqual(["d1-2b"]);
  });
});
