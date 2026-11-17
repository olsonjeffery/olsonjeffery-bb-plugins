// bb-plugin-basic-systemone — the SystemOne Decision Model foundation plugin.
//
// One job, three surfaces:
// - Settings designate the provider + decision model. Until both exist every
//   SystemOne feature is disabled (the `bb systemone` CLI included).
// - The `bb systemone` CLI designates the model and asks questions, echoing
//   each structured response to stdout for capture.
// - The RPC contract (status / ask / listProviders / listModels) is the
//   library other plugins build on; the CLI wraps the same handlers.
//
// There is deliberately no UI yet and no agent tool: the CLI plus the
// bundled skills are the whole workflow for now.

import {
  PluginCliError,
  type BbPluginApi,
  type PluginCliContext,
} from "@get-bb/plugin-sdk";
import {
  SYSTEMONE_REQUEST_PATH,
  DmError,
  endpointUrl,
  listDecisionModels,
  postDecisionRequest,
  prepareRequest,
  resolveDesignation,
  type DecisionSettings,
  type DesignationStatus,
} from "./dm.js";
import { providerProfile } from "./providers.js";
import {
  buildSystemoneCli,
  type CatalogModel,
  type CatalogProvider,
  type DesignationPatch,
} from "./cli.js";
import { rpcContract } from "./contract.js";

/**
 * Resolve the host that owns the invoking CLI call: the thread's
 * environment's host when a thread invoked the command, else the server
 * machine (`bb.sdk.files`' default). Payload files for `-f` live there.
 */
async function invokingHostId(
  bb: BbPluginApi,
  ctx: PluginCliContext,
): Promise<string | undefined> {
  if (ctx.threadId === undefined) return undefined;
  try {
    const thread = await bb.sdk.threads.get({ threadId: ctx.threadId });
    if (thread.environmentId === null) return undefined;
    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    return environment.hostId;
  } catch (cause) {
    bb.log.debug(
      `could not resolve the invoking host for the payload file read: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return undefined;
  }
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loading");

  const settings = bb.settings.define({
    providerId: {
      type: "string",
      label: "Decision-model provider",
      default: "",
    },
    modelId: {
      type: "string",
      label: "Decision model",
      default: "",
    },
    baseUrl: {
      type: "string",
      label: "Endpoint base URL override",
      default: "",
    },
    apiKey: {
      type: "string",
      label: "Decision endpoint API key",
      secret: true,
    },
  });

  // Settings read fresh in every handler, so `model set` needs no reload.
  const readSettings = async (): Promise<DecisionSettings> => {
    const values = await settings.get();
    return {
      providerId: typeof values.providerId === "string" ? values.providerId : "",
      modelId: typeof values.modelId === "string" ? values.modelId : "",
      baseUrl: typeof values.baseUrl === "string" ? values.baseUrl : "",
      apiKey: typeof values.apiKey === "string" ? values.apiKey : "",
    };
  };

  // The shared core: one designation check for CLI and RPC.
  const currentDesignation = async (): Promise<DesignationStatus> => {
    const values = await readSettings();
    return resolveDesignation(values, providerProfile(values.providerId)?.baseUrl);
  };

  /** The one decision request path; CLI `question` and RPC `ask` share it. */
  async function ask(
    request: Record<string, unknown>,
    options: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<{ response: Record<string, unknown>; modelId: string; requestUrl: string }> {
    const status = await currentDesignation();
    if (!status.enabled) {
      const detail =
        status.reason === "no-provider"
          ? "no provider is designated"
          : "no decision model is designated for the provider";
      throw new DmError(`SystemOne is disabled: ${detail}.`, {
        code: "systemone_disabled",
        hint: "Designate one with `bb systemone model set <provider> <model>`.",
      });
    }
    const designation = status.designation;
    const prepared = prepareRequest(request, designation.modelId);
    const url = endpointUrl(designation.baseUrl, SYSTEMONE_REQUEST_PATH);
    const result = await postDecisionRequest({
      url,
      request: prepared,
      apiKey: designation.apiKey,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    if (result.status !== 200) {
      throw new DmError(`The decision endpoint answered HTTP ${result.status}.`, {
        code: "upstream_error",
      });
    }
    return {
      response: result.json as Record<string, unknown>,
      modelId: designation.modelId,
      requestUrl: url,
    };
  }

  const listProviders = async (): Promise<CatalogProvider[]> => {
    const providers = await bb.sdk.providers.list();
    return providers.map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      available: provider.available,
    }));
  };

  const listCatalogModels = async (providerId: string): Promise<CatalogModel[]> => {
    const options = await bb.sdk.providers.models({ providerId });
    return options.models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      description: model.description,
    }));
  };

  // ---- CLI ----------------------------------------------------------------

  bb.cli.register(
    buildSystemoneCli({
      readSettings,
      patchSettings: async (patch: DesignationPatch) => {
        await settings.experimental_set({
          providerId: patch.providerId,
          modelId: patch.modelId,
          baseUrl: patch.baseUrl,
          ...(patch.apiKey === undefined ? {} : { apiKey: patch.apiKey }),
        });
        return readSettings();
      },
      listCatalogProviders: listProviders,
      listCatalogModels,
      readPayloadFile: async (ctx: PluginCliContext, path: string) => {
        const trimmed = path.trim();
        let absolute = trimmed;
        if (absolute.startsWith("~")) {
          throw new PluginCliError(
            "The payload file path must be absolute (a leading ~ is not resolved).",
            { code: "invalid_value" },
          );
        }
        if (!absolute.startsWith("/")) {
          if (ctx.cwd === undefined) {
            throw new PluginCliError("The payload file path must be absolute.", {
              code: "invalid_value",
              hint: "Pass an absolute path, e.g. --file /tmp/request.json.",
            });
          }
          absolute = `${ctx.cwd.replace(/\/+$/, "")}/${absolute}`;
        }
        const hostId = await invokingHostId(bb, ctx);
        try {
          const file = await bb.sdk.files.read({ hostId, path: absolute });
          return file.contentEncoding === "base64"
            ? Buffer.from(file.content, "base64").toString("utf8")
            : file.content;
        } catch (cause) {
          throw new PluginCliError(
            `Could not read the payload file: ${cause instanceof Error ? cause.message : String(cause)}`,
            {
              code: "payload_file_unreadable",
              hint:
                "--file reads the file from the invoking thread's host; " +
                "check the path, or pass the payload as the JSON argument.",
            },
          );
        }
      },
    }),
  );

  // ---- RPC (the library other plugins build on) ---------------------------

  bb.rpc.register(
    rpcContract,
    {
      status: async () => {
        const values = await readSettings();
        const profile = providerProfile(values.providerId);
        const status = resolveDesignation(values, profile?.baseUrl);
        const effectiveBase =
          values.baseUrl !== "" ? values.baseUrl : (profile?.baseUrl ?? "");
        let requestUrl = "";
        if (effectiveBase !== "") {
          try {
            requestUrl = endpointUrl(effectiveBase, SYSTEMONE_REQUEST_PATH);
          } catch {
            requestUrl = ""; // an invalid stored override surfaces when it is used
          }
        }
        const baseUrlSource =
          effectiveBase === ""
            ? null
            : values.baseUrl !== ""
              ? ("override" as const)
              : profile !== null
                ? ("profile" as const)
                : null;
        return {
          enabled: status.enabled,
          disabledReason: status.enabled ? null : status.reason,
          providerId: values.providerId,
          modelId: values.modelId,
          baseUrl: effectiveBase,
          baseUrlSource,
          requestUrl,
          apiKeySet: values.apiKey !== "",
        };
      },
      ask: async (input, context) =>
        ask(input.request, {
          timeoutMs: input.timeoutMs,
          signal: context.experimental_signal,
        }),
      listProviders: async () => {
        const providers = await listProviders();
        return {
          providers: [
            {
              id: "liquid",
              displayName: "Liquid AI (hosted decision models)",
              source: "builtin" as const,
              decisionEndpoint: true,
              available: null,
              notes:
                "SystemOne API at api.liquid.ai; Bearer LIQUID_API_KEY. Hosted models: d1.2, d1.2-ultra.",
            },
            {
              id: "llama-server",
              displayName: "llama.cpp llama serve (local decision models)",
              source: "builtin" as const,
              decisionEndpoint: true,
              available: null,
              notes:
                "POST /v1/systemone from `llama serve` (llama.cpp 0.8.0+); open-weight d1 GGUF servers answer Noul, Choice, and Score over text, pictures, and video.",
            },
            ...providers
              .filter(
                (provider) => provider.id !== "liquid" && provider.id !== "llama-server",
              )
              .map((provider) => ({
                id: provider.id,
                displayName: provider.displayName,
                source: "catalog" as const,
                decisionEndpoint: false,
                available: provider.available,
                notes:
                  "BB provider catalog; decision requests need --base-url (and an API key when the endpoint needs one).",
              })),
          ],
        };
      },
      listModels: async ({ providerId }) => {
        const values = await readSettings();
        const profile = providerProfile(providerId);
        if (profile === null) {
          const models = await listCatalogModels(providerId);
          return {
            providerId,
            models: models.map((model) => ({
              id: model.id,
              description: model.description ?? model.displayName,
              releaseDate: null,
              inputModalities: null,
            })),
          };
        }
        const base =
          values.providerId === providerId && values.baseUrl !== ""
            ? values.baseUrl
            : profile.baseUrl;
        const models = await listDecisionModels({
          url: endpointUrl(base, profile.modelsPath ?? "/v1/models"),
          apiKey: values.apiKey,
        });
        return { providerId, models };
      },
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "SystemOne Decision Model library: designate a provider + decision model, ask full SystemOne requests, list decision-model providers and models.",
    },
  );

  bb.onDispose(() => {
    bb.log.info("disposed");
  });

  bb.log.info("loaded");
}
