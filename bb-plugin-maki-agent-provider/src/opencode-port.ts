import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { PortReport, PortedProvider, PortSkip } from "./contract.js";

const PORT_MARKER =
  "# --- OpenCode providers ported by bb's maki Agent Provider plugin ---";

/** Maki slugs that are built in or shipped as bundled Lua plugins. */
const MAKI_BUILTIN_SLUGS = new Set([
  "anthropic",
  "openai",
  "google",
  "copilot",
  "ollama",
  "llama-cpp",
  "zai",
  "xai",
  "aperture",
  "opencode",
  "opencode-go",
  "deepseek",
  "mistral",
  "openrouter",
  "regolo",
  "requesty",
  "synthetic",
  "tensorx",
]);

const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u;

/** npm AI SDK packages mapped to maki wire protocols. */
const NPM_PROTOCOLS: Readonly<Record<string, string>> = {
  "@ai-sdk/anthropic": "anthropic",
  "@ai-sdk/google": "google",
  "@ai-sdk/google-vertex": "google",
  "@ai-sdk/google-vertex-anthropic": "google",
  "@ai-sdk/openai": "openai",
  "@ai-sdk/openai-compatible": "openai",
  "@ai-sdk/openai-responses": "openai-responses",
  "@ai-sdk/amazon-bedrock": "openai",
  "@ai-sdk/azure": "openai",
  "@ai-sdk/azure-rest": "openai",
};

interface OpencodeModel {
  name?: unknown;
  reasoning?: unknown;
  limit?: { context?: unknown; output?: unknown };
  cost?: {
    input?: unknown;
    output?: unknown;
    cache_read?: unknown;
    cache_write?: unknown;
  };
}

interface OpencodeProvider {
  name?: unknown;
  npm?: unknown;
  options?: { baseURL?: unknown; apiKey?: unknown };
  models?: Record<string, OpencodeModel>;
}

interface OpencodeConfig {
  provider?: Record<string, OpencodeProvider>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stripJsonComments(text: string): string {
  let result = "";
  let index = 0;
  let inString = false;
  while (index < text.length) {
    const character = text[index];
    if (inString) {
      result += character;
      if (character === "\\") {
        result += text[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (character === '"') inString = false;
      index += 1;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      index += 1;
      continue;
    }
    if (character === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    result += character;
    index += 1;
  }
  return result.replace(/,(\s*[}\]])/gu, "$1");
}

function parseJsonLenient(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(stripJsonComments(text));
  }
}

function xdgHome(
  env: NodeJS.ProcessEnv,
  variable: "XDG_CONFIG_HOME" | "XDG_DATA_HOME",
  fallback: string,
): string {
  const fromEnv = asString(env[variable]);
  if (fromEnv !== null && path.isAbsolute(fromEnv)) return fromEnv;
  return path.join(os.homedir(), fallback);
}

export function opencodeConfigPath(env: NodeJS.ProcessEnv): string {
  const fromEnv = asString(env.OPENCODE_CONFIG);
  if (fromEnv !== null) return fromEnv;
  return path.join(
    xdgHome(env, "XDG_CONFIG_HOME", ".config"),
    "opencode",
    "opencode.json",
  );
}

export function opencodeAuthPath(env: NodeJS.ProcessEnv): string {
  return path.join(
    xdgHome(env, "XDG_DATA_HOME", ".local/share"),
    "opencode",
    "auth.json",
  );
}

export function makiProvidersPath(env: NodeJS.ProcessEnv): string {
  if (process.platform === "win32") {
    return path.join(env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "maki", "providers.toml");
  }
  return path.join(
    xdgHome(env, "XDG_CONFIG_HOME", ".config"),
    "maki",
    "providers.toml",
  );
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlNumber(value: number): string {
  return String(value);
}

function optionalField(
  lines: string[],
  key: string,
  value: string | null,
): void {
  if (value !== null) lines.push(`${key} = ${value}`);
}

function protocolForNpm(npm: string | null): string | null {
  if (npm === null) return null;
  return NPM_PROTOCOLS[npm] ?? "openai";
}

function sanitizeSlug(raw: string): { slug: string; changed: boolean } {
  if (SLUG_PATTERN.test(raw)) return { slug: raw, changed: false };
  const slug = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/gu, "-")
    .replace(/^[-_]+/u, "")
    .replace(/[-_]+$/u, "");
  return { slug: slug === "" ? "" : slug, changed: slug !== raw };
}

function portedModelId(key: string, slug: string): string {
  const prefix = `${slug}/`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function buildProviderTables(
  slug: string,
  provider: OpencodeProvider,
  apiKey: string | null,
): string[] {
  const lines: string[] = [];
  lines.push(`[${slug}]`);
  optionalField(
    lines,
    "display_name",
    asString(provider.name) === null
      ? null
      : tomlString(asString(provider.name)!),
  );
  const protocol = protocolForNpm(asString(provider.npm));
  if (protocol !== null) lines.push(`protocol = ${tomlString(protocol)}`);
  const baseURL = asString(provider.options?.baseURL);
  if (baseURL !== null) lines.push(`base_url = ${tomlString(baseURL)}`);
  if (apiKey !== null) lines.push(`api_key = ${tomlString(apiKey)}`);
  const models = provider.models ?? {};
  const modelKeys = Object.keys(models);
  if (modelKeys.length === 0) {
    // No inline catalog: let maki discover models from the provider endpoint.
    lines.push("discover_models = true");
  }
  for (const key of modelKeys) {
    const model = models[key] ?? {};
    const id = portedModelId(key, slug);
    lines.push("");
    lines.push(`[[${slug}.models]]`);
    lines.push(`id = ${tomlString(id)}`);
    const contextWindow = asNumber(model.limit?.context);
    if (contextWindow !== null) {
      lines.push(`context_window = ${tomlNumber(contextWindow)}`);
    }
    const maxOutput = asNumber(model.limit?.output);
    if (maxOutput !== null) {
      lines.push(`max_output_tokens = ${tomlNumber(maxOutput)}`);
    }
    if (model.reasoning === true) lines.push("supports_thinking = true");
    const costInput = asNumber(model.cost?.input);
    if (costInput !== null) lines.push(`pricing_input = ${costInput}`);
    const costOutput = asNumber(model.cost?.output);
    if (costOutput !== null) lines.push(`pricing_output = ${costOutput}`);
    const cacheRead = asNumber(model.cost?.cache_read);
    if (cacheRead !== null) lines.push(`pricing_cache_read = ${cacheRead}`);
    const cacheWrite = asNumber(model.cost?.cache_write);
    if (cacheWrite !== null) lines.push(`pricing_cache_write = ${cacheWrite}`);
  }
  return lines;
}

interface ExistingSlugsResult {
  slugs: Set<string>;
  warnings: string[];
}

function readExistingSlugs(
  existingText: string | null,
): ExistingSlugsResult {
  if (existingText === null || existingText.trim() === "") {
    return { slugs: new Set(), warnings: [] };
  }
  try {
    const parsed = parseToml(existingText);
    return {
      slugs: new Set(Object.keys(parsed).filter((key) => typeof key === "string")),
      warnings: [],
    };
  } catch (error) {
    return {
      slugs: new Set(),
      warnings: [
        `Existing maki providers.toml could not be parsed; no entries were merged (${error instanceof Error ? error.message : String(error)}).`,
      ],
    };
  }
}

export function buildProvidersPort(args: {
  existingText: string | null;
  opencodeConfig: OpencodeConfig | null;
  authEntries: Record<string, { type?: unknown; key?: unknown }> | null;
}): {
  report: Omit<
    PortReport,
    "makiConfigPath" | "opencodeConfigPath" | "opencodeFound"
  >;
  appendedToml: string | null;
} {
  const added: PortedProvider[] = [];
  const skipped: PortSkip[] = [];
  const warnings: string[] = [];
  const builtinKeySlugs: string[] = [];
  const { slugs: existingSlugs, warnings: parseWarnings } = readExistingSlugs(
    args.existingText,
  );
  warnings.push(...parseWarnings);

  const authEntries = args.authEntries ?? {};
  const blocks: string[] = [];
  // The JSON was parsed at the boundary above; everything past here treats
  // provider entries as typed values.
  const providers = (args.opencodeConfig?.provider ?? {}) as Record<
    string,
    OpencodeProvider
  >;

  for (const [rawSlug, entry] of Object.entries(providers)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      skipped.push({ slug: rawSlug, reason: "Not a valid provider entry." });
      continue;
    }
    const { slug, changed } = sanitizeSlug(rawSlug);
    if (slug === "") {
      skipped.push({ slug: rawSlug, reason: "Slug is empty or unusable." });
      continue;
    }
    if (changed) {
      warnings.push(
        `opencode provider "${rawSlug}" was ported as "${slug}" (maki slug rules).`,
      );
    }
    if (MAKI_BUILTIN_SLUGS.has(slug)) {
      const authEntry = authEntries[slug];
      const key =
        authEntry !== undefined && authEntry.type === "api"
          ? asString(authEntry.key)
          : null;
      if (key !== null) {
        blocks.push(`[${slug}]\napi_key = ${tomlString(key)}\n`);
        builtinKeySlugs.push(slug);
      } else {
        skipped.push({
          slug,
          reason: "A built-in maki provider already owns this slug.",
        });
      }
      continue;
    }
    if (existingSlugs.has(slug)) {
      skipped.push({
        slug,
        reason: "maki's providers.toml already has this slug.",
      });
      continue;
    }
    const authEntry = authEntries[slug];
    let apiKey: string | null = null;
    if (authEntry !== undefined) {
      if (authEntry.type === "api") {
        apiKey = asString(authEntry.key);
      } else {
        warnings.push(
          `"${slug}" is signed in with OAuth in opencode; run \`maki auth login ${slug}\` in maki.`,
        );
      }
    }
    if (apiKey === null) apiKey = asString(entry.options?.apiKey);
    const modelCount = Object.keys(entry.models ?? {}).length;
    blocks.push(`${buildProviderTables(slug, entry, apiKey).join("\n")}\n`);
    added.push({
      slug,
      displayName: asString(entry.name) ?? slug,
      models: modelCount,
      portedApiKey: apiKey !== null,
    });
  }

  const appendedToml =
    added.length === 0 && builtinKeySlugs.length === 0
      ? null
      : `${PORT_MARKER}\n${blocks.join("\n")}`;

  return { report: { added, skipped, builtinKeySlugs, warnings }, appendedToml };
}

export async function portOpencodeProviders(
  env: NodeJS.ProcessEnv,
): Promise<PortReport> {
  const makiConfigPath = makiProvidersPath(env);
  const opencodePath = opencodeConfigPath(env);

  let opencodeText: string | null = null;
  try {
    opencodeText = await fs.readFile(opencodePath, "utf8");
  } catch {
    return {
      makiConfigPath,
      opencodeConfigPath: null,
      opencodeFound: false,
      added: [],
      skipped: [],
      builtinKeySlugs: [],
      warnings: [
        `No opencode config found at ${opencodePath}. Set OPENCODE_CONFIG if yours lives elsewhere.`,
      ],
    };
  }

  let opencodeConfig: OpencodeConfig | null = null;
  try {
    const parsed = parseJsonLenient(opencodeText);
    opencodeConfig = isRecord(parsed) ? (parsed as OpencodeConfig) : null;
  } catch (error) {
    return {
      makiConfigPath,
      opencodeConfigPath: opencodePath,
      opencodeFound: true,
      added: [],
      skipped: [],
      builtinKeySlugs: [],
      warnings: [
        `opencode config could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  let existingText: string | null = null;
  try {
    existingText = await fs.readFile(makiConfigPath, "utf8");
  } catch {
    existingText = null;
  }

  let authEntries: Record<string, { type?: unknown; key?: unknown }> | null =
    null;
  try {
    const parsed = parseJsonLenient(
      await fs.readFile(opencodeAuthPath(env), "utf8"),
    );
    authEntries = isRecord(parsed) ? (parsed as never) : null;
  } catch {
    authEntries = null;
  }

  const { report, appendedToml } = buildProvidersPort({
    existingText,
    opencodeConfig,
    authEntries,
  });

  if (appendedToml !== null) {
    const next = `${existingText === null || existingText.trim() === "" ? "" : `${existingText.replace(/\n+$/u, "")}\n\n`}${appendedToml}`;
    const parent = path.dirname(makiConfigPath);
    await fs.mkdir(parent, { recursive: true });
    const tempPath = path.join(
      parent,
      `.providers.toml.${process.pid}.${Date.now()}.tmp`,
    );
    await fs.writeFile(tempPath, next, { mode: 0o600 });
    await fs.chmod(tempPath, 0o600);
    await fs.rename(tempPath, makiConfigPath);
  }

  return {
    makiConfigPath,
    opencodeConfigPath: opencodePath,
    opencodeFound: true,
    ...report,
  };
}
