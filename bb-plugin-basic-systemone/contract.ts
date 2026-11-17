// contract.ts — the plugin's RPC contract.
//
// This is the library surface other plugins build on: they call these
// methods with `bb.sdk.plugins.callRpc({ pluginId: "basic-systemone", … })`.
// The CLI wraps the same handlers, so a thread agent (through `bb systemone`)
// and a dependent plugin see one behavior.
//
// The contract stays deliberately loose about SystemOne request and answer
// bodies: they are forwarded and echoed as received, validated only where a
// shape is certain (the top-level response envelope).

import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const systemoneStatusOutput = z.object({
  enabled: z.boolean(),
  /** Present when disabled: "no-provider" | "no-model". */
  disabledReason: z.enum(["no-provider", "no-model"]).nullable(),
  providerId: z.string(),
  modelId: z.string(),
  /** Effective SystemOne base URL, "" when unresolved. */
  baseUrl: z.string(),
  /** Where the base URL came from, null when disabled or unresolved. */
  baseUrlSource: z.enum(["override", "profile"]).nullable(),
  /** URL the request would POST to, "" when unresolved. */
  requestUrl: z.string(),
  apiKeySet: z.boolean(),
});

export const systemoneAskInput = z
  .object({
    /** The full SystemOne request; `model` may be omitted (designation fills it). */
    request: z.record(z.string(), z.unknown()),
    /** Clamp for the upstream call; defaults to 60s, capped at 60s. */
    timeoutMs: z.number().int().min(1000).max(60_000).optional(),
  })
  .strict();

export const systemoneAskOutput = z.object({
  /** The SystemOne response body: { model, answers, usage }. */
  response: z.record(z.string(), z.unknown()),
  modelId: z.string(),
  requestUrl: z.string(),
});

export const systemoneProvidersOutput = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      /** "builtin" profiles speak the SystemOne API natively; "catalog" is BB's provider directory. */
      source: z.enum(["builtin", "catalog"]),
      /** True when a SystemOne decision endpoint is known without --base-url. */
      decisionEndpoint: z.boolean(),
      /** Catalog availability; null for builtin profiles. */
      available: z.boolean().nullable(),
      notes: z.string(),
    }),
  ),
});

export const systemoneModelsOutput = z.object({
  providerId: z.string(),
  models: z.array(
    z.object({
      id: z.string(),
      description: z.string().nullable(),
      releaseDate: z.string().nullable(),
      inputModalities: z.array(z.string()).nullable(),
    }),
  ),
});

export const rpcContract = defineRpcContract({
  /** Designation + gate state; the first thing a dependent plugin checks. */
  status: { input: z.null(), output: systemoneStatusOutput },
  /** Post one full SystemOne request; throws with a code when gated or rejected. */
  ask: { input: systemoneAskInput, output: systemoneAskOutput },
  /** The models-dropdown data: builtin profiles plus BB's provider catalog. */
  listProviders: { input: z.null(), output: systemoneProvidersOutput },
  /** One provider's decision models. */
  listModels: {
    input: z.object({ providerId: z.string() }).strict(),
    output: systemoneModelsOutput,
  },
});

export type SystemoneStatus = z.infer<typeof systemoneStatusOutput>;
export type SystemoneAskResult = z.infer<typeof systemoneAskOutput>;
export type SystemoneProviders = z.infer<typeof systemoneProvidersOutput>;
export type SystemoneModels = z.infer<typeof systemoneModelsOutput>;
