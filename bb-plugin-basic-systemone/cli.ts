// cli.ts — the `bb systemone` command.
//
// The spec is built by buildSystemoneCli(deps) so the server factory wires
// settings, the BB provider catalog, and host file reads in one place, and
// the handlers stay small. Every command reports the gate honestly: model
// selection stays available while every question command refuses until a
// provider + decision model are designated.

import { PluginCliError, cliCommand, defineCli, type PluginCliContext } from "@get-bb/plugin-sdk";
import { DECISION_PROVIDER_PROFILES, providerProfile, type DecisionProviderProfile } from "./providers.js";
import {
  DECISION_MODELS_PATH,
  SYSTEMONE_REQUEST_PATH,
  DmError,
  endpointUrl,
  listDecisionModels,
  postDecisionRequest,
  prepareRequest,
  resolveDesignation,
  type DecisionDesignation,
  type DecisionSettings,
  type DecisionModelInfo,
  type JsonObject,
} from "./dm.js";

export interface CatalogProvider {
  id: string;
  displayName: string;
  available: boolean;
}

export interface CatalogModel {
  id: string;
  displayName: string;
  description: string | null;
}

/** One field set by `model set`; null resets it to its default. */
export interface DesignationPatch {
  providerId: string;
  modelId: string;
  baseUrl: string | null;
  apiKey?: string | null;
}

/** What the server factory provides; keeps handlers free of bb plumbing. */
export interface SystemoneCliDeps {
  readSettings(): Promise<DecisionSettings>;
  patchSettings(patch: DesignationPatch): Promise<DecisionSettings>;
  listCatalogProviders(): Promise<CatalogProvider[]>;
  listCatalogModels(providerId: string): Promise<CatalogModel[]>;
  /** Read a payload file from the invoking thread's host. */
  readPayloadFile(ctx: PluginCliContext, path: string): Promise<string>;
  /** Injectable fetch for tests; defaults to the global. */
  fetchImpl?: typeof fetch;
}

const DECISION_PROVIDER_IDS: ReadonlySet<string> = new Set(
  DECISION_PROVIDER_PROFILES.map((profile) => profile.id),
);

export const DEFAULT_QUESTION_TIMEOUT_MS = 60_000;
const MODELS_LIST_LIMIT = 100;

/** Translate DmError into the CLI's error envelope shape. */
function toCliError(error: unknown): unknown {
  if (error instanceof DmError) {
    return new PluginCliError(error.message, { code: error.code, hint: error.hint });
  }
  return error;
}

/** Effective base URL for listing models of one provider. */
function listingBaseUrl(
  settings: DecisionSettings,
  providerId: string,
  profile: DecisionProviderProfile | null,
): string {
  if (settings.providerId === providerId && settings.baseUrl !== "") {
    return settings.baseUrl;
  }
  if (profile !== null) return profile.baseUrl;
  throw new DmError(
    `No decision endpoint is known for provider "${providerId}": it is not a built-in profile ` +
      "and no --base-url override is stored for it.",
    {
      code: "endpoint_unresolved",
      hint:
        "Designate it with `bb systemone model set " +
        providerId +
        " <model> --base-url <url>` (SystemOne base URL, ending before /v1/systemone).",
    },
  );
}

function authLine(
  settings: DecisionSettings,
  profile: DecisionProviderProfile | null,
): string {
  if (settings.apiKey !== "") return "Bearer API key set";
  if (profile === null) return "No API key set";
  return profile.auth === "none"
    ? "No auth (open endpoint)"
    : "No API key set (the endpoint may answer HTTP 401)";
}

function gateError(status: Extract<ReturnType<typeof resolveDesignation>, { enabled: false }>): PluginCliError {
  const hint =
    status.reason === "no-provider"
      ? "Run `bb systemone model set <provider> <model>` — candidates: `bb systemone model list-providers`."
      : "Run `bb systemone model list-models " +
        "<provider>` to see its decision models, then `bb systemone model set <provider> <model>`.";
  const detail =
    status.reason === "no-provider"
      ? "no provider is designated"
      : "no decision model is designated for the provider";
  return new PluginCliError(`SystemOne is disabled: ${detail}.`, {
    code: "systemone_disabled",
    hint,
  });
}

export function buildSystemoneCli(deps: SystemoneCliDeps) {
  return defineCli({
    name: "systemone",
    summary: "SystemOne decision-model queries (Basic SystemOne)",
    description:
      "Ask a designated decision model typed questions over the SystemOne API. " +
      "Everything except `model` commands stays disabled until " +
      "`bb systemone model set` picks a provider and decision model.",
    commands: {
      "model show": cliCommand({
        summary: "Show the designated provider and decision model, or why SystemOne is disabled",
        options: {
          json: { type: "boolean", description: "Emit machine-readable JSON" },
        },
        async run(input) {
          const settings = await deps.readSettings();
          const profile = providerProfile(settings.providerId);
          const status = resolveDesignation(settings, profile?.baseUrl);
          const effectiveBase =
            settings.baseUrl !== "" ? settings.baseUrl : (profile?.baseUrl ?? "");
          let requestUrl = "";
          if (effectiveBase !== "") {
            try {
              requestUrl = endpointUrl(effectiveBase, SYSTEMONE_REQUEST_PATH);
            } catch {
              requestUrl = ""; // an invalid stored override surfaces when it is used
            }
          }
          const baseUrlSource =
            settings.baseUrl !== "" ? "override" : profile !== null ? "profile" : null;
          if (input.options.json) {
            return {
              exitCode: 0,
              stdout:
                JSON.stringify(
                  status.enabled
                    ? {
                        enabled: true,
                        disabledReason: null,
                        providerId: settings.providerId,
                        modelId: settings.modelId,
                        baseUrl: status.designation.baseUrl,
                        baseUrlSource,
                        requestUrl,
                        apiKeySet: settings.apiKey !== "",
                      }
                    : {
                        enabled: false,
                        disabledReason: status.reason,
                        providerId: settings.providerId,
                        modelId: settings.modelId,
                        baseUrl: effectiveBase,
                        baseUrlSource,
                        requestUrl,
                        apiKeySet: settings.apiKey !== "",
                      },
                ) + "\n",
            };
          }
          if (!status.enabled) {
            const lines =
              status.reason === "no-provider"
                ? [
                    "SystemOne: disabled — no provider is designated.",
                    "Designate a provider and model:",
                    "  bb systemone model set <provider> <model>",
                    "Candidates:",
                    "  bb systemone model list-providers",
                  ]
                : [
                    "SystemOne: disabled — no decision model designated.",
                    `Provider "${settings.providerId}" is designated; pick its model:`,
                    `  bb systemone model list-models ${settings.providerId}`,
                    `  bb systemone model set ${settings.providerId} <model>`,
                  ];
            return { exitCode: 0, stdout: lines.join("\n") + "\n" };
          }
          const designation = status.designation;
          const lines = [
            "SystemOne: enabled",
            `Provider: ${designation.providerId}${profile === null ? "" : ` — ${profile.displayName}`}`,
            `Model: ${designation.modelId}`,
            `Endpoint: ${requestUrl} (base ${designation.baseUrlSource}: ${designation.baseUrl})`,
            `Auth: ${authLine(settings, profile)}`,
          ];
          return { exitCode: 0, stdout: lines.join("\n") + "\n" };
        },
      }),

      "model set": cliCommand({
        summary: "Designate the provider and decision model that every question command uses",
        positionals: [
          { name: "providerId", description: "Provider id (see `model list-providers`)", required: true },
          { name: "modelId", description: "Decision model id, exactly as its provider lists it", required: true },
        ],
        options: {
          json: { type: "boolean", description: "Emit machine-readable JSON" },
          "base-url": {
            type: "string",
            placeholder: "url",
            description:
              "SystemOne base URL override, ending before /v1/systemone " +
              "(required for providers without a built-in endpoint)",
          },
          "api-key": {
            type: "string",
            stdin: true,
            description:
              "Bearer API key for the decision endpoint; pipe it as --api-key-stdin to keep it out of argv",
          },
          "clear-api-key": {
            type: "boolean",
            description: "Forget the stored API key",
          },
        },
        constraints: [{ kind: "at-most-one", options: ["api-key", "clear-api-key"] }],
        async run(input) {
          const providerId = input.positionals.providerId.trim();
          const modelId = input.positionals.modelId.trim();
          if (providerId === "" || modelId === "") {
            throw new PluginCliError("The provider and model ids must not be empty.", {
              code: "invalid_value",
            });
          }
          const profile = providerProfile(providerId);
          const baseUrlOption = input.options["base-url"];
          let baseUrl: string | null;
          if (baseUrlOption !== undefined) {
            const trimmed = baseUrlOption.trim().replace(/\/+$/, "");
            let parsed: URL;
            try {
              parsed = new URL(trimmed);
            } catch {
              throw new PluginCliError(`--base-url is not a valid URL: ${trimmed}`, {
                code: "invalid_value",
                hint: "Use a base like https://api.liquid.ai/decisions or http://127.0.0.1:9931.",
              });
            }
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              throw new PluginCliError(`--base-url must use http or https: ${trimmed}`, {
                code: "invalid_value",
              });
            }
            baseUrl = trimmed;
          } else if (profile !== null) {
            baseUrl = null; // clear any override; the profile default applies again
          } else {
            throw new PluginCliError(
              `No built-in decision endpoint for provider "${providerId}".`,
              {
                code: "endpoint_unresolved",
                hint:
                  "Pass --base-url <url> (the SystemOne base URL, ending before /v1/systemone) — " +
                  "e.g. --base-url https://api.liquid.ai/decisions or --base-url http://127.0.0.1:9931 — " +
                  "plus --api-key-stdin when the endpoint needs a key.",
              },
            );
          }
          const patch: DesignationPatch = { providerId, modelId, baseUrl };
          if (input.options["clear-api-key"]) patch.apiKey = null;
          else if (input.options["api-key"] !== undefined) patch.apiKey = input.options["api-key"];
          const settings = await deps.patchSettings(patch);
          const effectiveBase =
            settings.baseUrl !== "" ? settings.baseUrl : (providerProfile(providerId)?.baseUrl ?? "");
          if (input.options.json) {
            return {
              exitCode: 0,
              stdout:
                JSON.stringify({
                  ok: true,
                  enabled: true,
                  providerId,
                  modelId,
                  baseUrl: effectiveBase,
                  apiKeySet: settings.apiKey !== "",
                }) + "\n",
            };
          }
          const lines = [
            "Designated the SystemOne decision model:",
            `Provider: ${providerId}${profile === null ? "" : ` — ${profile.displayName}`}`,
            `Model: ${modelId}`,
            `Endpoint base: ${effectiveBase}`,
            `Auth: ${authLine(settings, providerProfile(providerId))}`,
            "SystemOne is enabled; check with `bb systemone model show`.",
          ];
          return { exitCode: 0, stdout: lines.join("\n") + "\n" };
        },
      }),

      "model clear": cliCommand({
        summary: "Clear the designation; every question command stops until a model is set again",
        options: {
          json: { type: "boolean", description: "Emit machine-readable JSON" },
        },
        async run(input) {
          await deps.patchSettings({ providerId: "", modelId: "", baseUrl: null });
          if (input.options.json) {
            return { exitCode: 0, stdout: JSON.stringify({ ok: true, enabled: false }) + "\n" };
          }
          return {
            exitCode: 0,
            stdout:
              "Cleared the designation and the endpoint override; SystemOne commands are " +
              "disabled until `bb systemone model set` runs again. The stored API key is kept; " +
              "forget it with `model set … --clear-api-key`.\n",
          };
        },
      }),

      "model list-providers": cliCommand({
        summary:
          "List providers that can serve the decision model: built-in profiles and BB's provider catalog",
        options: {
          json: { type: "boolean", description: "Emit machine-readable JSON" },
        },
        async run(input) {
          let catalog: CatalogProvider[];
          try {
            catalog = await deps.listCatalogProviders();
          } catch (cause) {
            throw new PluginCliError(
              `Could not list BB's provider catalog: ${cause instanceof Error ? cause.message : String(cause)}`,
              { code: "catalog_unavailable", hint: "Check `bb provider list`." },
            );
          }
          const builtinRows = DECISION_PROVIDER_PROFILES.map((profile) => ({
            id: profile.id,
            displayName: profile.displayName,
            source: "builtin" as const,
            decisionEndpoint: true,
            available: null,
            baseUrl: profile.baseUrl,
            auth: profile.auth,
            notes: profile.notes,
          }));
          const catalogRows = catalog
            .filter((provider) => !DECISION_PROVIDER_IDS.has(provider.id))
            .map((provider) => ({
              id: provider.id,
              displayName: provider.displayName,
              source: "catalog" as const,
              decisionEndpoint: false,
              available: provider.available,
              baseUrl: null,
              auth: null,
              notes:
                "BB provider catalog; decision requests need --base-url " +
                "(and an API key when the endpoint needs one).",
            }));
          const rows = [...builtinRows, ...catalogRows];
          if (input.options.json) {
            return { exitCode: 0, stdout: JSON.stringify({ providers: rows }, null, 2) + "\n" };
          }
          const pad = (value: string, width: number) => value.padEnd(width, " ");
          const idWidth = Math.max(...rows.map((row) => row.id.length), "Provider".length);
          const lines = [
            pad("Provider", idWidth) + "  Source    Auth     State       Name",
            ...rows.map((row) =>
              pad(row.id, idWidth) +
              "  " +
              pad(row.source, 9) +
              " " +
              pad(row.auth ?? "?", 8) +
              " " +
              pad(
                row.available === null ? "—" : row.available ? "available" : "signed out",
                11,
              ) +
              " " +
              row.displayName,
            ),
            "",
            "Set one with: bb systemone model set <provider> <model> [--base-url <url>] [--api-key-stdin]",
          ];
          return { exitCode: 0, stdout: lines.join("\n") + "\n" };
        },
      }),

      "model list-models": cliCommand({
        summary: "List the decision models one provider exposes",
        positionals: [
          { name: "providerId", description: "Provider id (see `model list-providers`)", required: true },
        ],
        options: {
          json: { type: "boolean", description: "Emit machine-readable JSON" },
          limit: {
            type: "integer",
            min: 1,
            max: 500,
            default: MODELS_LIST_LIMIT,
            description: "Cap on listed models (catalog providers can list hundreds)",
          },
        },
        async run(input, ctx) {
          const providerId = input.positionals.providerId.trim();
          const settings = await deps.readSettings();
          const profile = providerProfile(providerId);
          const models: DecisionModelInfo[] = [];
          let truncated = false;
          let total: number | undefined;
          if (profile === null) {
            let catalog: CatalogModel[];
            try {
              catalog = await deps.listCatalogModels(providerId);
            } catch (cause) {
              throw new PluginCliError(
                `Could not list models for provider "${providerId}": ${cause instanceof Error ? cause.message : String(cause)}`,
                {
                  code: "catalog_unavailable",
                  hint: "Enable or sign in to the provider first (see `bb provider list`).",
                },
              );
            }
            if (catalog.length === 0) {
              throw new PluginCliError(
                `Provider "${providerId}" listed no models.`,
                { code: "catalog_unavailable", hint: "Check `bb provider models " + providerId + "`." },
              );
            }
            total = catalog.length;
            truncated = catalog.length > input.options.limit;
            models.push(
              ...catalog.slice(0, input.options.limit).map((model) => ({
                id: model.id,
                description: model.description ?? model.displayName,
                releaseDate: null,
                inputModalities: null,
              })),
            );
          } else {
            const base = listingBaseUrl(settings, providerId, profile);
            const url = endpointUrl(base, profile.modelsPath ?? DECISION_MODELS_PATH);
            const listed = await listDecisionModels({
              url,
              apiKey: settings.apiKey,
              signal: ctx.signal,
              fetchImpl: deps.fetchImpl,
            });
            total = listed.length;
            truncated = listed.length > input.options.limit;
            models.push(...listed.slice(0, input.options.limit));
          }
          if (input.options.json) {
            return {
              exitCode: 0,
              stdout:
                JSON.stringify(
                  total === undefined
                    ? { providerId, models }
                    : { providerId, models, total, truncated },
                  null,
                  2,
                ) + "\n",
            };
          }
          const lines = [`Decision models for ${providerId}:`];
          for (const model of models) {
            const description = model.description === null ? "" : `  ${model.description}`;
            const modalities =
              model.inputModalities === null ? "" : `  [${model.inputModalities.join(", ")}]`;
            lines.push(`  ${model.id}${description}${modalities}`);
          }
          if (truncated && total !== undefined) {
            lines.push(
              `  … ${total - models.length} more; raise --limit (default ${MODELS_LIST_LIMIT}).`,
            );
          }
          return { exitCode: 0, stdout: lines.join("\n") + "\n" };
        },
      }),

      question: cliCommand({
        summary: "Ask the designated decision model; echoes the structured answer JSON to stdout",
        description:
          "The payload is the full SystemOne decision-model request and stays authoritative; " +
          "the designated model fills in `model` when the payload omits it. " +
          "The response JSON is echoed whole on stdout for capture.",
        positionals: [
          {
            name: "payload",
            description:
              'Full decision-model request as JSON: {"model"?,"state"?,"images"?,"questions":{…}}',
            required: false,
          },
        ],
        options: {
          file: {
            type: "string",
            short: "f",
            placeholder: "path",
            description:
              "Load the request payload from this JSON file on the invoking thread's host",
          },
          timeout: {
            type: "duration",
            defaultUnit: "s",
            default: DEFAULT_QUESTION_TIMEOUT_MS,
            min: 1_000,
            max: 600_000,
            description: "How long to wait for the decision response",
          },
          json: {
            type: "boolean",
            description: "Echo the response as one line of JSON (default: pretty-printed)",
          },
        },
        async run(input, ctx) {
          const payloadArg = input.positionals.payload;
          const fileArg = input.options.file;
          if (payloadArg !== undefined && fileArg !== undefined) {
            throw new PluginCliError(
              "Give the request payload either as the JSON argument or with --file, not both.",
              { code: "invalid_value" },
            );
          }
          let raw: string;
          if (fileArg !== undefined) {
            raw = await deps.readPayloadFile(ctx, fileArg);
          } else if (payloadArg !== undefined) {
            if (payloadArg.trim() === "-") {
              throw new PluginCliError(
                "Reading the payload from stdin is not supported; pass the JSON argument, " +
                  "or write it to a file and use --file.",
                { code: "invalid_value" },
              );
            }
            raw = payloadArg;
          } else {
            throw new PluginCliError(
              "No request payload given. Pass the full decision-model request JSON as the " +
                "argument, or load one with --file <path>.",
              { code: "missing_required", hint: "Check the designation first: `bb systemone model show`." },
            );
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch (cause) {
            throw new PluginCliError(
              `The request payload is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
              {
                code: "invalid_payload",
                hint:
                  "The payload is one JSON object, the full decision-model request " +
                  '(e.g. {"model":"…","state":"…","questions":{…}}); --file reads it from a path.',
              },
            );
          }
          const settings = await deps.readSettings();
          const profile = providerProfile(settings.providerId);
          const status = resolveDesignation(settings, profile?.baseUrl);
          if (!status.enabled) throw gateError(status);
          const designation: DecisionDesignation = status.designation;
          let request: JsonObject;
          try {
            request = prepareRequest(parsed, designation.modelId);
          } catch (cause) {
            throw toCliError(cause);
          }
          let url: string;
          try {
            url = endpointUrl(designation.baseUrl, SYSTEMONE_REQUEST_PATH);
          } catch (cause) {
            throw toCliError(cause);
          }
          const result = await postDecisionRequest({
            url,
            request,
            apiKey: designation.apiKey,
            timeoutMs: input.options.timeout,
            signal: ctx.signal,
            fetchImpl: deps.fetchImpl,
          });
          const body = input.options.json
            ? JSON.stringify(result.json)
            : JSON.stringify(result.json, null, 2);
          return { exitCode: 0, stdout: body + "\n" };
        },
      }),
    },
  });
}
