// providers.ts — the built-in decision-model provider profiles.
//
// A profile knows where a SystemOne decision endpoint lives and how it
// authenticates. Any other provider id works too when the caller supplies
// `--base-url` (and, when needed, an API key): gateways and self-hosted
// servers that speak the SystemOne API do not need code changes here.

import { DECISION_MODELS_PATH } from "./dm.js";

export interface DecisionProviderProfile {
  id: string;
  displayName: string;
  /** SystemOne base URL, ending before /v1/systemone. */
  baseUrl: string;
  auth: "bearer" | "none";
  /** GET path listing the provider's decision models, or null. */
  modelsPath: string | null;
  notes: string;
}

export const DECISION_PROVIDER_PROFILES: readonly DecisionProviderProfile[] = [
  {
    id: "liquid",
    displayName: "Liquid AI (hosted decision models)",
    baseUrl: "https://api.liquid.ai/decisions",
    auth: "bearer",
    modelsPath: DECISION_MODELS_PATH,
    notes:
      "SystemOne API at api.liquid.ai; Bearer LIQUID_API_KEY. Hosted models: d1.2, d1.2-ultra.",
  },
  {
    id: "llama-server",
    displayName: "llama.cpp llama serve (local decision models)",
    baseUrl: "http://127.0.0.1:9931",
    auth: "none",
    modelsPath: DECISION_MODELS_PATH,
    notes:
      "POST /v1/systemone from `llama serve` (llama.cpp 0.8.0+); open-weight d1 GGUF servers answer Noul, Choice, and Score over text, pictures, and video.",
  },
];

export function providerProfile(providerId: string): DecisionProviderProfile | null {
  return (
    DECISION_PROVIDER_PROFILES.find(
      (profile) => profile.id === providerId,
    ) ?? null
  );
}
