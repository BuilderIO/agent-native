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
 * order controls priority — Anthropic wins when multiple keys coexist.
 */
export function detectEngineFromEnv(): AgentEngineEntry | null {
  for (const entry of _registry.values()) {
    if (entry.requiredEnvVars.length === 0) continue;
    if (entry.requiredEnvVars.every((v) => !!process.env[v])) {
      return entry;
    }
  }
  return null;
}

/**
 * True when an `agent-engine` setting entry names an engine AND carries an
 * API key (top-level or inside `config`). Shared between the onboarding step
 * and the /agent-engine/status endpoint so both agree on "is this configured".
 */
export function isAgentEngineSettingConfigured(stored: unknown): boolean {
  if (!stored || typeof stored !== "object") return false;
  const s = stored as {
    engine?: unknown;
    apiKey?: unknown;
    config?: { apiKey?: unknown };
  };
  if (typeof s.engine !== "string" || !s.engine) return false;
  if (typeof s.apiKey === "string" && s.apiKey) return true;
  if (s.config && typeof s.config.apiKey === "string" && s.config.apiKey) {
    return true;
  }
  return false;
}

/**
 * True when the stored `agent-engine` row points at a registered engine
 * AND an API key for it is reachable — either inline (settings + `config`)
 * or via the engine's required env vars. When false, callers should fall
 * through to env-detection so a stale disconnected row can't hijack chat.
 */
export function isStoredEngineUsable(
  stored: unknown,
  entry: AgentEngineEntry,
): boolean {
  if (isAgentEngineSettingConfigured(stored)) return true;
  if (entry.requiredEnvVars.length === 0) return true;
  return entry.requiredEnvVars.every((v) => !!process.env[v]);
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
        const storedApiKey = (stored.apiKey as string | undefined) ?? apiKey;
        return entry.create({
          apiKey: storedApiKey,
          ...((stored.config as Record<string, unknown>) ?? {}),
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

  // 6. Auto-detect from any provider env var — so just dropping a key in
  // .env works without also setting AGENT_ENGINE.
  const detected = detectEngineFromEnv();
  if (detected) return detected.create({ apiKey });

  // 7. Default: anthropic
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
 * The settings UI writes `{engine, model}` via the `set-agent-engine` action,
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
