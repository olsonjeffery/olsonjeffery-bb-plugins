import os from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildProvidersPort,
  makiProvidersPath,
  opencodeAuthPath,
  opencodeConfigPath,
} from "./opencode-port.js";

const opencodeConfig = {
  provider: {
    "llama-local": {
      name: "Llama.cpp (local)",
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: "http://localhost:8080/v1" },
      models: {
        "llama-local/Qwen3.6-27B-GGUF": {
          name: "Qwen3.6-27B Q4_K_XL",
          limit: { context: 131072, output: 8192 },
          reasoning: true,
          cost: { input: 0.5, output: 1.5, cache_read: 0.1 },
        },
        "llama-local/gemma4-31B": { name: "gemma4-31B" },
      },
    },
    "llama-3090": {
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: "http://192.168.137.184:8080/v1" },
      models: { "unsloth/Qwen3.6-27B-GGUF": {} },
    },
    anthropic: { npm: "@ai-sdk/anthropic" },
    "weird slug!": { npm: "@ai-sdk/openai" },
    myProxy: { npm: "@ai-sdk/openai" },
  },
};

function build(
  existingText: string | null,
  auth: Record<string, { type?: unknown; key?: unknown }> = {},
) {
  return buildProvidersPort({
    existingText,
    opencodeConfig: opencodeConfig as never,
    authEntries: { anthropic: { type: "api", key: "sk-ant-test" }, ...auth },
  });
}

describe("buildProvidersPort", () => {
  it("ports custom providers with wire protocol, models, limits and pricing", () => {
    const { report, appendedToml } = build(null);
    expect(report.added.map((entry) => entry.slug)).toEqual([
      "llama-local",
      "llama-3090",
      "weird-slug",
      "myProxy",
    ]);
    expect(report.added[0]?.models).toBe(2);
    expect(appendedToml).toContain("[llama-local]");
    expect(appendedToml).toContain('display_name = "Llama.cpp (local)"');
    expect(appendedToml).toContain('protocol = "openai"');
    expect(appendedToml).toContain('base_url = "http://localhost:8080/v1"');
    expect(appendedToml).toContain('id = "Qwen3.6-27B-GGUF"');
    expect(appendedToml).toContain("context_window = 131072");
    expect(appendedToml).toContain("supports_thinking = true");
    expect(appendedToml).toContain("pricing_cache_read = 0.1");
  });

  it("keeps model ids from other slugs intact", () => {
    const { appendedToml } = build(null);
    expect(appendedToml).toContain('id = "unsloth/Qwen3.6-27B-GGUF"');
  });

  it("marks providers without an inline catalog as discoverable", () => {
    const { report, appendedToml } = build(null);
    const llama3090 = report.added.find((entry) => entry.slug === "llama-3090");
    expect(llama3090?.models).toBe(1);
    expect(appendedToml).toContain("discover_models = true");
  });

  it("skips built-in slugs but ports their stored API key", () => {
    const { report, appendedToml } = build(null);
    expect(report.builtinKeySlugs).toEqual(["anthropic"]);
    expect(appendedToml).toContain('[anthropic]\napi_key = "sk-ant-test"');
  });

  it("skips slugs that already exist in maki's providers.toml", () => {
    const { report, appendedToml } = build(
      '[myProxy]\nprotocol = "openai"\n',
    );
    expect(report.skipped.map((skip) => skip.slug)).toContain("myProxy");
    expect(appendedToml).not.toContain("[myProxy]");
  });

  it("warns about OAuth credentials instead of porting them", () => {
    const { report } = build(null, {
      "llama-local": { type: "oauth" },
    });
    expect(
      report.warnings.some((warning) =>
        warning.includes("`maki auth login llama-local`"),
      ),
    ).toBe(true);
  });

  it("reports paths from the environment", () => {
    const env = {
      XDG_CONFIG_HOME: "/x",
      XDG_DATA_HOME: "/y",
      HOME: "/h",
    } as NodeJS.ProcessEnv;
    expect(opencodeConfigPath(env)).toBe("/x/opencode/opencode.json");
    expect(opencodeAuthPath(env)).toBe("/y/opencode/auth.json");
    expect(makiProvidersPath(env)).toBe("/x/maki/providers.toml");
    expect(opencodeConfigPath({} as NodeJS.ProcessEnv)).toBe(
      os.homedir() + "/.config/opencode/opencode.json",
    );
  });
});
