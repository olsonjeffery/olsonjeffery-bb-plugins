// dm.ts — the basic SystemOne decision-model library behind the plugin.
//
// One module owns every decision-model concern so other code (the CLI, the
// RPC contract, future plugins calling this plugin over RPC) shares one
// implementation: designation resolution, request preparation, the HTTP
// call, response/error mapping, and decision-model listing.
//
// The request and response shapes follow the SystemOne API documented at
// https://docs.liquid.ai/api/reference/decision-models/make-decisions —
// POST <base>/v1/systemone with `{ model, state?, images?, questions }`,
// answered by `{ model, answers, usage }`. Local servers such as
// `llama serve` expose the same request at <base>/v1/systemone.

/** The plugin's decision-model settings, as stored ("" means unset). */
export interface DecisionSettings {
  providerId: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
}

/** The empty settings value. */
export function emptyDecisionSettings(): DecisionSettings {
  return { providerId: "", modelId: "", baseUrl: "", apiKey: "" };
}

/** A resolved provider + model designation ready to take requests. */
export interface DecisionDesignation {
  providerId: string;
  modelId: string;
  /** Effective SystemOne base URL: the override, else the profile default. */
  baseUrl: string;
  /** Where the effective base URL came from. */
  baseUrlSource: "override" | "profile";
  /** Bearer key, "" when the endpoint takes none. */
  apiKey: string;
}

export type DesignationStatus =
  | { enabled: false; reason: "no-provider" | "no-model" }
  | { enabled: true; designation: DecisionDesignation };

/**
 * The user's gate: every SystemOne feature except `model` commands stays
 * disabled until both a provider and a model are designated.
 */
export function resolveDesignation(
  settings: DecisionSettings,
  profileBaseUrl?: string,
): DesignationStatus {
  if (settings.providerId === "") return { enabled: false, reason: "no-provider" };
  if (settings.modelId === "") return { enabled: false, reason: "no-model" };
  const baseUrl =
    settings.baseUrl !== "" ? settings.baseUrl : (profileBaseUrl ?? "");
  return {
    enabled: true,
    designation: {
      providerId: settings.providerId,
      modelId: settings.modelId,
      baseUrl,
      baseUrlSource: settings.baseUrl !== "" ? "override" : "profile",
      apiKey: settings.apiKey,
    },
  };
}

/**
 * The SystemOne request path every decision endpoint shares, appended to
 * the base URL: `https://api.liquid.ai/decisions/v1/systemone`,
 * `http://127.0.0.1:9931/v1/systemone`.
 */
export const SYSTEMONE_REQUEST_PATH = "/v1/systemone";

/** The decision-model listing path (GET) for providers that expose one. */
export const DECISION_MODELS_PATH = "/v1/models";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

/** A failure the library raises, carrying a CLI-ready code and hint. */
export class DmError extends Error {
  readonly code: string;
  readonly hint: string | undefined;

  constructor(message: string, options?: { code?: string; hint?: string }) {
    super(message);
    this.name = "DmError";
    this.code = options?.code ?? "decision_request_failed";
    this.hint = options?.hint;
  }
}

/** Truncate upstream text into a bounded, single-line snippet. */
export function snippet(text: string, max = 500): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Turn a base URL into a validated absolute URL for `path`. The base ends
 * before `/v1/systemone`: `https://api.liquid.ai/decisions` or
 * `http://127.0.0.1:9931`.
 */
export function endpointUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed === "") {
    throw new DmError("No decision endpoint base URL is configured.", {
      code: "endpoint_unresolved",
      hint:
        "Designate the model with `bb systemone model set <provider> <model> --base-url <url>` " +
        "(the SystemOne base URL, ending before /v1/systemone).",
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new DmError(`The endpoint base URL is not a valid URL: ${snippet(trimmed, 120)}`, {
      code: "invalid_value",
      hint:
        "Set a base URL like https://api.liquid.ai/decisions or http://127.0.0.1:9931 " +
        "with `bb systemone model set <provider> <model> --base-url <url>`.",
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DmError(
      `The endpoint base URL must use http or https: ${snippet(trimmed, 120)}`,
      { code: "invalid_value" },
    );
  }
  const base = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  return `${base}${path}`;
}

/**
 * Prepare the outgoing request from the caller's payload.
 *
 * The payload is the full SystemOne request and stays authoritative: it is
 * forwarded exactly as given. The designated model fills in `model` only
 * when the payload omits it. Structural checks stay shallow — anything the
 * endpoint rejects surfaces as the endpoint's 422 with its detail.
 */
export function prepareRequest(payload: unknown, modelId: string): JsonObject {
  if (!isJsonObject(payload)) {
    throw new DmError("The request payload must be a JSON object.", {
      code: "invalid_payload",
      hint:
        "Pass the full decision-model request as JSON, e.g. " +
        `{"model":"…","state":"…","questions":{…}}, or load it with --file.`,
    });
  }
  const questions = payload["questions"];
  if (!isJsonObject(questions)) {
    throw new DmError("The request payload has no questions object.", {
      code: "invalid_payload",
      hint:
        "The request needs a `questions` object, e.g. " +
        `"questions":{"topic":{"type":"choice","instructions":"…","criteria":{…}}}.`,
    });
  }
  if (Object.keys(questions).length === 0) {
    throw new DmError("The request payload's questions object is empty.", {
      code: "invalid_payload",
      hint: "Add at least one named question under `questions`.",
    });
  }
  for (const [id, question] of Object.entries(questions)) {
    if (!isJsonObject(question)) {
      throw new DmError(`Question "${id}" is not a JSON object.`, {
        code: "invalid_payload",
      });
    }
  }
  const images = payload["images"];
  if (images !== undefined && !Array.isArray(images)) {
    throw new DmError("The request payload's images must be an array.", {
      code: "invalid_payload",
      hint: "Each image is a data: URL or a { content_type, base64 } object.",
    });
  }
  const request: JsonObject = { ...payload };
  if (request["model"] === undefined) request["model"] = modelId;
  return request;
}

/** Compose an abort signal with a timeout into one signal. */
export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cancel: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
  const cancel = () => clearTimeout(timer);
  const abortFrom = (cause: unknown) => {
    cancel();
    controller.abort(cause);
  };
  if (signal !== undefined) {
    if (signal.aborted) abortFrom(signal.reason);
    else signal.addEventListener("abort", () => abortFrom(signal.reason), { once: true });
  }
  return { signal: controller.signal, cancel };
}

/** Injectable fetch for tests: sync or async, defaults to the global. */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Response | Promise<Response>;

export interface DecisionRequestInput {
  /** Absolute SystemOne request URL, e.g. https://api.liquid.ai/decisions/v1/systemone */
  url: string;
  /** Full request payload, model included. */
  request: JsonObject;
  /** Bearer token, or "" for open endpoints. */
  apiKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
}

export interface DecisionRequestResult {
  status: number;
  /** The parsed JSON response body, echoed to callers as received. */
  json: unknown;
}

/**
 * POST one SystemOne request and return the parsed response. Network,
 * timeout, and HTTP failures throw DmError with a CLI-ready code.
 */
export async function postDecisionRequest(
  input: DecisionRequestInput,
): Promise<DecisionRequestResult> {
  const { url, request } = input;
  const timeoutMs = input.timeoutMs ?? 60_000;
  const { signal, cancel } = withTimeout(input.signal, timeoutMs);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (input.apiKey !== undefined && input.apiKey !== "") {
    headers["authorization"] = `Bearer ${input.apiKey}`;
  }
  let response: Response;
  try {
    const doFetch = (input.fetchImpl ?? fetch) as FetchLike;
    response = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal,
    });
  } catch (cause) {
    cancel();
    if (signal.aborted) {
      const reason = signal.reason;
      if (reason instanceof Error && reason.name === "TimeoutError") {
        throw new DmError(`The decision request timed out after ${Math.round(timeoutMs / 1000)}s.`, {
          code: "timeout",
          hint: "Raise the timeout, or check that the decision endpoint is responding.",
        });
      }
      if (input.signal?.aborted) throw new DmError("The decision request was cancelled.", {
        code: "cancelled",
      });
    }
    throw new DmError(`Could not reach the decision endpoint: ${stringifyCause(cause)}`, {
      code: "network_error",
      hint:
        "Check the endpoint base URL, and for a local server (llama-server) " +
        "that `llama serve …` is running.",
    });
  }
  cancel();
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    if (!response.ok) throw mapHttpError(response.status, text);
    throw new DmError(
      `The decision endpoint returned non-JSON content (status ${response.status}): ${snippet(text)}`,
      { code: "bad_response" },
    );
  }
  if (!response.ok) throw mapHttpError(response.status, text, json);
  return { status: response.status, json };
}

/** Map an upstream HTTP failure onto a DmError with a code and hint. */
export function mapHttpError(status: number, body: string, json?: unknown): DmError {
  const detail = upstreamDetail(body, json);
  const withDetail = (message: string) =>
    detail === null ? message : `${message}: ${detail}`;
  if (status === 401 || status === 403) {
    return new DmError(withDetail(`The decision endpoint rejected the credentials (HTTP ${status}).`), {
      code: "auth_failed",
      hint:
        "Set the endpoint's API key: `bb systemone model set <provider> <model> --api-key-stdin` " +
        "(pipe the key in), or clear a stale one with --clear-api-key.",
    });
  }
  if (status === 422) {
    return new DmError(withDetail(`The decision endpoint rejected the request payload (HTTP 422).`), {
      code: "invalid_request",
      hint:
        "Check the request payload against the request schema the caller " +
        "instructed you to use; the endpoint's detail above says what failed.",
    });
  }
  if (status === 429) {
    return new DmError(withDetail("The decision endpoint rate-limited the request (HTTP 429)."), {
      code: "rate_limited",
      hint: "Wait and retry; a request is billed per question, so batch questions together.",
    });
  }
  if (status === 404) {
    return new DmError(withDetail("The decision endpoint does not exist (HTTP 404)."), {
      code: "endpoint_not_found",
      hint:
        "The base URL must end before /v1/systemone (e.g. https://api.liquid.ai/decisions). " +
        "Fix it with `bb systemone model set <provider> <model> --base-url <url>`.",
    });
  }
  return new DmError(withDetail(`The decision endpoint failed (HTTP ${status}).`), {
    code: "upstream_error",
  });
}

function upstreamDetail(body: string, json: unknown): string | null {
  if (isJsonObject(json)) {
    for (const key of ["detail", "error", "message"]) {
      const value = json[key];
      if (typeof value === "string" && value.trim() !== "") return snippet(value, 300);
      if (value !== undefined && value !== null) return snippet(JSON.stringify(value), 300);
    }
  }
  if (body.trim() !== "") return snippet(body, 300);
  return null;
}

function stringifyCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/** One decision model as `list-models` and the RPC `listModels` return it. */
export interface DecisionModelInfo {
  id: string;
  description: string | null;
  releaseDate: string | null;
  inputModalities: string[] | null;
}

/**
 * Normalize either listing shape:
 * - Liquid decisions: `{ models: [{ name, description?, release_date?, input_modalities? }] }`
 * - OpenAI-compatible servers: `{ data: [{ id, … }] }` (e.g. `llama serve`)
 */
export function normalizeModelList(payload: unknown): DecisionModelInfo[] {
  if (!isJsonObject(payload)) {
    throw new DmError("The decision-model listing response was not a JSON object.", {
      code: "bad_response",
    });
  }
  const raw = Array.isArray(payload["models"])
    ? payload["models"]
    : Array.isArray(payload["data"])
      ? payload["data"]
      : null;
  if (raw === null) {
    throw new DmError(
      'The decision-model listing response has neither a "models" nor a "data" array.',
      { code: "bad_response" },
    );
  }
  const models: DecisionModelInfo[] = [];
  for (const entry of raw) {
    if (!isJsonObject(entry)) continue;
    const id = typeof entry["name"] === "string" ? entry["name"] : typeof entry["id"] === "string" ? entry["id"] : null;
    if (id === null) continue;
    models.push({
      id,
      description: typeof entry["description"] === "string" ? entry["description"] : null,
      releaseDate:
        typeof entry["release_date"] === "string" ? entry["release_date"] : null,
      inputModalities: Array.isArray(entry["input_modalities"])
        ? entry["input_modalities"].filter((m): m is string => typeof m === "string")
        : null,
    });
  }
  return models;
}

export interface DecisionModelsInput {
  /** Absolute decision-models URL, e.g. https://api.liquid.ai/decisions/v1/models */
  url: string;
  apiKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}

/** GET the provider's decision-model listing. */
export async function listDecisionModels(
  input: DecisionModelsInput,
): Promise<DecisionModelInfo[]> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const { signal, cancel } = withTimeout(input.signal, timeoutMs);
  const headers: Record<string, string> = { accept: "application/json" };
  if (input.apiKey !== undefined && input.apiKey !== "") {
    headers["authorization"] = `Bearer ${input.apiKey}`;
  }
  let response: Response;
  try {
    const doFetch = (input.fetchImpl ?? fetch) as FetchLike;
    response = await doFetch(input.url, { headers, signal });
  } catch (cause) {
    cancel();
    if (signal.aborted && signal.reason instanceof Error && signal.reason.name === "TimeoutError") {
      throw new DmError(`Listing decision models timed out after ${Math.round(timeoutMs / 1000)}s.`, {
        code: "timeout",
      });
    }
    throw new DmError(`Could not reach the decision endpoint: ${stringifyCause(cause)}`, {
      code: "network_error",
      hint:
        "Check the endpoint base URL, and for a local server (llama-server) " +
        "that `llama serve …` is running.",
    });
  }
  cancel();
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    if (!response.ok) throw mapHttpError(response.status, text);
    throw new DmError(
      `The decision-model listing returned non-JSON content (status ${response.status}): ${snippet(text)}`,
      { code: "bad_response" },
    );
  }
  if (!response.ok) throw mapHttpError(response.status, text, json);
  return normalizeModelList(json);
}
