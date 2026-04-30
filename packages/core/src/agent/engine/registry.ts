/**
 * Agent Engine Registry.
 *
 * Mirrors the CLI_REGISTRY pattern (packages/core/src/terminal/cli-registry.ts)
 * but is open — anyone can register a custom engine via registerAgentEngine()
 * from a server plugin at startup.
 *
 * Built-in engines (anthropic, ai-sdk) are auto-registered by builtin.ts.
 */

import type {
  AgentEngine,
  EngineCapabilities,
  EngineStreamOptions,
} from "./types.js";
import { getSetting } from "../../settings/store.js";
import { DEV_MODE_USER_EMAIL } from "../../server/auth.js";
import { readDeployCredentialEnv } from "../../server/credential-provider.js";

export interface AgentEngineEntry {
  /** Unique name, e.g. "anthropic", "ai-sdk:anthropic", "ai-sdk:openai" */
  name: string;
  /** Human-readable label for UI */
  label: string;
  /** Short description for engine picker */
  description: string;
  /** npm package hint displayed in UI when package is missing */
  installPackage?: string;
  /** Engine capabilities */
  capabilities: EngineCapabilities;
  /** Default model string */
  defaultModel: string;
  /** All supported models (shown in model picker) */
  supportedModels: readonly string[];
  /** Environment variables required for this engine to work */
  requiredEnvVars: string[];
  /** Create an engine instance from config */
  create(config: Record<string, unknown>): AgentEngine;
}

const _registry = new Map<string, AgentEngineEntry>();

/**
 * Register a custom agent engine. Called at server startup (e.g., from a
 * server plugin or builtin.ts). Throws if name is already registered.
 */
export function registerAgentEngine(entry: AgentEngineEntry): void {
  if (_registry.has(entry.name)) {
    // Allow re-registration in tests / hot-reload — just overwrite
    if (process.env.NODE_ENV === "test") {
      _registry.set(entry.name, entry);
      return;
    }
    console.warn(
      `[agent-engine] Engine "${entry.name}" is already registered. Skipping.`,
    );
    return;
  }
  _registry.set(entry.name, entry);
}

/** Get a registered engine entry by name, or undefined if not found */
export function getAgentEngineEntry(
  name: string,
): AgentEngineEntry | undefined {
  return _registry.get(name);
}

/** List all registered engine entries */
export function listAgentEngines(): AgentEngineEntry[] {
  return Array.from(_registry.values());
}

/**
 * First registered engine whose requiredEnvVars are all set. Registration
 * order controls priority — the Builder gateway is registered first so it
 * wins when the Builder private key is present.
 *
 * Escape hatch: AGENT_ENGINE_PREFER_BYO_KEY=true skips the Builder engine
 * on the first pass, so an explicit provider key (ANTHROPIC_API_KEY etc.)
 * is picked instead. Builder is still used as the fallback when no other
 * provider key is set.
 */
export function detectEngineFromEnv(): AgentEngineEntry | null {
  const preferByo = /^(1|true)$/i.test(
    process.env.AGENT_ENGINE_PREFER_BYO_KEY ?? "",
  );

  if (preferByo) {
    for (const entry of _registry.values()) {
      if (entry.name === "builder") continue;
      if (entry.requiredEnvVars.length === 0) continue;
      if (entry.requiredEnvVars.every((v) => !!readDeployCredentialEnv(v))) {
        return entry;
      }
    }
    // No BYO key matched — fall through to include Builder as fallback.
  }

  for (const entry of _registry.values()) {
    if (entry.requiredEnvVars.length === 0) continue;
    if (entry.requiredEnvVars.every((v) => !!readDeployCredentialEnv(v))) {
      return entry;
    }
  }
  return null;
}

/**
 * Detect a usable engine from the current request user's per-user
 * `app_secrets` rows. Mirrors `detectEngineFromEnv` but consults the
 * encrypted secret store instead of `process.env`.
 *
 * Required because the Builder OAuth callback (and the settings UI's
 * "paste your own key" flow) writes credentials to app_secrets, not env.
 * Without this check, a user who connected Builder would see status
 * "configured" but the next chat turn would fall through to the default
 * Anthropic engine and hit `missing_api_key` — exactly Brent's symptom
 * on the docs site (Loom 2026-04-28: "It doesn't seem to realize I'm
 * connected once I do a chat").
 *
 * Returns `null` for unauthenticated requests and for `local@localhost`
 * — both rely on env-based detection (the dev box's deploy-level keys
 * are unambiguous, and unauthenticated requests have no user to scope by).
 */
export async function detectEngineFromUserSecrets(): Promise<AgentEngineEntry | null> {
  let email: string | undefined;
  try {
    const { getRequestUserEmail } =
      await import("../../server/request-context.js");
    email = getRequestUserEmail();
  } catch {
    return null;
  }
  if (!email || email === DEV_MODE_USER_EMAIL) return null;

  let readAppSecret: typeof import("../../secrets/storage.js").readAppSecret;
  try {
    ({ readAppSecret } = await import("../../secrets/storage.js"));
  } catch {
    return null;
  }

  const hasAllKeys = async (entry: AgentEngineEntry): Promise<boolean> => {
    if (entry.requiredEnvVars.length === 0) return false;
    for (const key of entry.requiredEnvVars) {
      try {
        const secret = await readAppSecret({
          key,
          scope: "user",
          scopeId: email!,
        });
        if (!secret?.value) return false;
      } catch {
        return false;
      }
    }
    return true;
  };

  const preferByo = /^(1|true)$/i.test(
    process.env.AGENT_ENGINE_PREFER_BYO_KEY ?? "",
  );

  if (preferByo) {
    for (const entry of _registry.values()) {
      if (entry.name === "builder") continue;
      if (await hasAllKeys(entry)) return entry;
    }
    // No BYO key matched — fall through to include Builder as fallback.
  }

  for (const entry of _registry.values()) {
    if (await hasAllKeys(entry)) return entry;
  }
  return null;
}

/**
 * Legacy inline API keys on the global `agent-engine` settings row are
 * intentionally ignored. That row is deployment-wide, so treating
 * `{ apiKey }` or `{ config: { apiKey } }` as configured would let one
 * user's pasted key power every other user. Per-user keys live in
 * `app_secrets` and are resolved separately.
 */
export function isAgentEngineSettingConfigured(stored: unknown): boolean {
  if (!stored || typeof stored !== "object") return false;
  const s = stored as {
    engine?: unknown;
  };
  if (typeof s.engine !== "string" || !s.engine) return false;
  return false;
}

function stripInlineApiKeyConfig(
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!config) return {};
  const { apiKey: _discardedApiKey, ...safeConfig } = config;
  return safeConfig;
}

/**
 * True when the stored `agent-engine` row points at a registered engine
 * AND an API key for it is reachable via the engine's required env vars.
 * Inline keys on the global settings row are ignored; see
 * `isAgentEngineSettingConfigured`.
 */
export function isStoredEngineUsable(
  stored: unknown,
  entry: AgentEngineEntry,
): boolean {
  if (isAgentEngineSettingConfigured(stored)) return true;
  if (entry.requiredEnvVars.length === 0) return true;
  // guard:allow-env-credential — deploy-level engine usability check (whether the deploy has the env vars to run this engine), not per-user credential resolution.
  return entry.requiredEnvVars.every((v) => !!readDeployCredentialEnv(v));
}

export interface ResolveEngineConfig {
  /** Explicit engine name or instance from createAgentChatPlugin options */
  engineOption?:
    | string
    | AgentEngine
    | { name: string; config: Record<string, unknown> };
  /** API key (used as config for the resolved engine) */
  apiKey?: string;
  /** Model override (used as part of engine config) */
  model?: string;
}

/**
 * Resolve an AgentEngine from options → settings → env → default.
 *
 * Resolution order:
 * 1. Explicit `engineOption` from plugin options (string name, instance, or {name, config})
 * 2. Settings store key "agent-engine" → { engine: string }
 * 3. Env var AGENT_ENGINE
 * 4. Default "anthropic" (requires ANTHROPIC_API_KEY)
 */
export async function resolveEngine(
  config: ResolveEngineConfig,
): Promise<AgentEngine> {
  const { engineOption, apiKey, model: _model } = config;

  // 1. Explicit instance passed directly
  if (
    engineOption &&
    typeof engineOption === "object" &&
    "stream" in engineOption
  ) {
    return engineOption as AgentEngine;
  }

  // 2. Explicit {name, config} object
  if (
    engineOption &&
    typeof engineOption === "object" &&
    "name" in engineOption
  ) {
    const { name, config: engineConfig } = engineOption as {
      name: string;
      config: Record<string, unknown>;
    };
    const entry = _registry.get(name);
    if (!entry)
      throw new Error(
        `[agent-engine] Unknown engine: "${name}". Registered: ${[..._registry.keys()].join(", ")}`,
      );
    return entry.create({ apiKey, ...engineConfig });
  }

  // 3. Explicit string name from options
  if (typeof engineOption === "string") {
    const entry = _registry.get(engineOption);
    if (!entry)
      throw new Error(
        `[agent-engine] Unknown engine: "${engineOption}". Registered: ${[..._registry.keys()].join(", ")}`,
      );
    return entry.create({ apiKey });
  }

  // 4. Settings store — only when the stored row's API key is reachable.
  try {
    const stored = await getSetting("agent-engine");
    if (stored && typeof stored.engine === "string") {
      const entry = _registry.get(stored.engine);
      if (entry && isStoredEngineUsable(stored, entry)) {
        return entry.create({
          apiKey,
          ...stripInlineApiKeyConfig(
            stored.config as Record<string, unknown> | undefined,
          ),
        });
      }
    }
  } catch {
    // Settings not available — fall through
  }

  // 5. Env var — explicit engine name override
  const envEngine = process.env.AGENT_ENGINE;
  if (envEngine) {
    const entry = _registry.get(envEngine);
    if (entry) return entry.create({ apiKey });
  }

  // 6. Auto-detect from the current user's per-user `app_secrets` rows
  // (Builder OAuth callback + "paste your own key" settings flow write
  // here, not env). Comes before env-detection so a user-specific
  // connection wins over a stale deploy-level key.
  const detectedFromUser = await detectEngineFromUserSecrets();
  if (detectedFromUser) return detectedFromUser.create({ apiKey });

  // 8. Auto-detect from any provider env var — so just dropping a key in
  // .env works without also setting AGENT_ENGINE.
  const detected = detectEngineFromEnv();
  if (detected) return detected.create({ apiKey });

  // 9. Default: anthropic
  const anthropicEntry = _registry.get("anthropic");
  if (!anthropicEntry) {
    throw new Error(
      "[agent-engine] Default Anthropic engine is not registered. Did builtin.ts fail to load?",
    );
  }
  return anthropicEntry.create({ apiKey });
}

/**
 * Read the user-selected model for an engine from the `agent-engine` setting.
 *
 * The settings UI writes `{engine, model}` via the `manage-agent-engine` action="set",
 * but `resolveEngine` only uses the stored engine (the model is a separate
 * per-request concern). Call this helper alongside `resolveEngine` to honor
 * the user's model choice without requiring a process restart.
 *
 * Returns the stored model only when the stored engine name matches `engine`
 * — otherwise returns `undefined` to avoid applying an Anthropic model string
 * to, say, an OpenRouter engine.
 */
export async function getStoredModelForEngine(
  engine: AgentEngine | string,
): Promise<string | undefined> {
  const engineName = typeof engine === "string" ? engine : engine.name;
  try {
    const stored = await getSetting("agent-engine");
    if (
      stored &&
      typeof stored.engine === "string" &&
      stored.engine === engineName &&
      typeof stored.model === "string" &&
      stored.model.length > 0
    ) {
      return stored.model;
    }
  } catch {
    // Settings store not ready (fresh install, migration pending) — skip.
  }
  return undefined;
}
