/**
 * Agent Engine Registry.
 *
 * Mirrors the CLI_REGISTRY pattern (packages/core/src/terminal/cli-registry.ts)
 * but is open — anyone can register a custom engine via registerAgentEngine()
 * from a server plugin at startup.
 *
 * Built-in engines (anthropic, ai-sdk) are auto-registered by builtin.ts.
 */

import { createRequire } from "node:module";
import type { AgentEngine, EngineCapabilities } from "./types.js";
import { getSetting } from "../../settings/store.js";
import { getAgentAppModelDefaultForCurrentRequest } from "../app-model-defaults.js";
import {
  canUseDeployCredentialFallbackForRequest,
  readDeployCredentialEnv,
  resolveBuilderCredentials,
  resolveSecret,
} from "../../server/credential-provider.js";

const require = createRequire(import.meta.url);

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
const _packageAvailabilityCache = new Map<string, boolean>();

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

function packageNameFromInstallSpecifier(specifier: string): string | null {
  const trimmed = specifier.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("-")) return null;
  if (trimmed.startsWith("@")) {
    const slashIndex = trimmed.indexOf("/");
    if (slashIndex === -1) return trimmed;
    const versionIndex = trimmed.indexOf("@", slashIndex + 1);
    return versionIndex === -1 ? trimmed : trimmed.slice(0, versionIndex);
  }
  const versionIndex = trimmed.indexOf("@");
  return versionIndex === -1 ? trimmed : trimmed.slice(0, versionIndex);
}

function canResolvePackage(packageName: string): boolean {
  const cached = _packageAvailabilityCache.get(packageName);
  if (cached !== undefined) return cached;
  let available = false;
  try {
    require.resolve(packageName);
    available = true;
  } catch {
    available = false;
  }
  _packageAvailabilityCache.set(packageName, available);
  return available;
}

export function isAgentEnginePackageInstalled(
  entry: AgentEngineEntry,
): boolean {
  const packageNames =
    entry.installPackage
      ?.split(/\s+/)
      .map(packageNameFromInstallSpecifier)
      .filter((name): name is string => Boolean(name)) ?? [];
  return packageNames.every(canResolvePackage);
}

export function normalizeModelForEngine(
  engine: Pick<AgentEngine, "name" | "defaultModel" | "supportedModels">,
  model: string | null | undefined,
): string {
  const candidate = typeof model === "string" ? model.trim() : "";
  if (!candidate) return engine.defaultModel;

  if (engine.name !== "builder") return candidate;

  if (candidate === "auto" || engine.supportedModels.includes(candidate)) {
    return candidate;
  }

  return engine.supportedModels.includes("auto") ? "auto" : engine.defaultModel;
}

function assertAgentEnginePackageInstalled(entry: AgentEngineEntry): void {
  if (isAgentEnginePackageInstalled(entry)) return;
  const installHint = entry.installPackage
    ? ` Run: pnpm add ${entry.installPackage}`
    : "";
  throw new Error(
    `[agent-engine] Engine "${entry.name}" requires optional packages that are not installed in this app.${installHint}`,
  );
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
      if (!isAgentEnginePackageInstalled(entry)) continue;
      if (entry.requiredEnvVars.every((v) => !!readDeployCredentialEnv(v))) {
        return entry;
      }
    }
    // No BYO key matched — fall through to include Builder as fallback.
  }

  for (const entry of _registry.values()) {
    if (entry.requiredEnvVars.length === 0) continue;
    if (!isAgentEnginePackageInstalled(entry)) continue;
    if (entry.requiredEnvVars.every((v) => !!readDeployCredentialEnv(v))) {
      return entry;
    }
  }
  return null;
}

function shouldTraceEngineDetection(): boolean {
  return /^(1|true)$/i.test(
    process.env.AGENT_NATIVE_DEBUG_AGENT_ENGINE_DETECT ??
      process.env.AGENT_NATIVE_DEBUG_CREDENTIAL_RESOLVE ??
      "",
  );
}

/**
 * Detect a usable engine from the current request user's accessible
 * `app_secrets` rows. Mirrors `detectEngineFromEnv` but consults the
 * encrypted secret store instead of `process.env`, including org-scoped
 * credentials shared with the active organization.
 *
 * Required because the Builder OAuth callback (and the settings UI's
 * "paste your own key" flow) writes credentials to app_secrets, not env.
 * Without this check, a user who connected Builder would see status
 * "configured" but the next chat turn would fall through to the default
 * Anthropic engine and hit `missing_api_key` — exactly Brent's symptom
 * on the docs site (Loom 2026-04-28: "It doesn't seem to realize I'm
 * connected once I do a chat").
 *
 * Includes the local dev session (`local@localhost`): the Builder
 * OAuth flow writes credentials scoped to that email when run from
 * `pnpm dev`, so detection has to consult those rows or the dev user
 * sees the same "Connect your AI" card after they've already connected
 * (Sami, 2026-04-30). Org-scoped Builder credentials must also count here:
 * `/builder/status` resolves them via the same request org context, and the
 * chat engine picker must not disagree with that card.
 */
export async function detectEngineFromUserSecrets(): Promise<AgentEngineEntry | null> {
  const traceLookup = shouldTraceEngineDetection();
  let email: string | undefined;
  let orgId: string | null | undefined;
  try {
    const { getRequestUserEmail, getRequestOrgId } =
      await import("../../server/request-context.js");
    email = getRequestUserEmail();
    orgId = getRequestOrgId();
  } catch {
    if (traceLookup) {
      console.log(
        `[engine-detect] result=null reason=no-request-context email=(unknown) orgId=(unknown)`,
      );
    }
    return null;
  }
  if (!email) {
    if (traceLookup) {
      console.log(
        `[engine-detect] result=null reason=no-email email=(empty) orgId=${orgId ?? "(none)"}`,
      );
    }
    return null;
  }

  const hasAllKeys = async (entry: AgentEngineEntry): Promise<boolean> => {
    if (!isAgentEnginePackageInstalled(entry)) return false;
    if (entry.requiredEnvVars.length === 0) return false;
    if (entry.name === "builder") {
      const creds = await resolveBuilderCredentials();
      return Boolean(creds.privateKey && creds.publicKey);
    }
    for (const key of entry.requiredEnvVars) {
      try {
        if (!(await resolveSecret(key))) return false;
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
      if (await hasAllKeys(entry)) {
        if (traceLookup) {
          console.log(
            `[engine-detect] result=${entry.name} email=${email} orgId=${orgId ?? "(none)"} byo=true`,
          );
        }
        return entry;
      }
    }
    // No BYO key matched — fall through to include Builder as fallback.
  }

  for (const entry of _registry.values()) {
    if (await hasAllKeys(entry)) {
      if (traceLookup) {
        console.log(
          `[engine-detect] result=${entry.name} email=${email} orgId=${orgId ?? "(none)"}`,
        );
      }
      return entry;
    }
  }
  if (traceLookup) {
    console.log(
      `[engine-detect] result=null reason=no-engine-keys-found email=${email} orgId=${orgId ?? "(none)"}`,
    );
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

function engineCreateConfig(
  apiKey: string | undefined,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    apiKey,
    allowEnvFallback: canUseDeployCredentialFallbackForRequest(),
    ...(extra ?? {}),
  };
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
  if (!isAgentEnginePackageInstalled(entry)) return false;
  if (isAgentEngineSettingConfigured(stored)) return true;
  if (entry.requiredEnvVars.length === 0) return true;
  return entry.requiredEnvVars.every((v) => !!readDeployCredentialEnv(v));
}

/**
 * Request-aware version of `isStoredEngineUsable`.
 *
 * The settings row stores the selected engine/model, while credentials may
 * live in per-user/org `app_secrets`. The sync helper intentionally only sees
 * deploy env vars; this async helper is what request-time routes should use
 * when deciding whether a stored engine can actually run for the current user.
 */
export async function isStoredEngineUsableForRequest(
  stored: unknown,
  entry: AgentEngineEntry,
): Promise<boolean> {
  if (!isAgentEnginePackageInstalled(entry)) return false;
  if (isAgentEngineSettingConfigured(stored)) return true;
  if (entry.requiredEnvVars.length === 0) return true;
  if (entry.name === "builder") {
    const creds = await resolveBuilderCredentials();
    return Boolean(creds.privateKey && creds.publicKey);
  }
  for (const key of entry.requiredEnvVars) {
    try {
      if (await resolveSecret(key)) continue;
    } catch {
      // Fall through to the deployment-level check below.
    }
    if (
      !canUseDeployCredentialFallbackForRequest() ||
      !readDeployCredentialEnv(key)
    ) {
      return false;
    }
  }
  return true;
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
  /** App/template id used for org-scoped per-app model defaults. */
  appId?: string;
}

/**
 * Resolve an AgentEngine from options → explicit env → app default →
 * request credentials → settings → env → default.
 *
 * Resolution order:
 * 1. Explicit `engineOption` from plugin options (string name, instance, or {name, config})
 * 2. Env var AGENT_ENGINE
 * 3. Org/user app-template default, when usable
 * 4. Current request's app_secrets; Builder wins by default when connected
 * 5. Settings store key "agent-engine" → { engine: string }, when usable
 * 6. Auto-detect deployment env credentials
 * 7. Default "anthropic" (requires ANTHROPIC_API_KEY)
 */
export async function resolveEngine(
  config: ResolveEngineConfig,
): Promise<AgentEngine> {
  const { engineOption, apiKey, model: _model, appId } = config;

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
    assertAgentEnginePackageInstalled(entry);
    return entry.create(engineCreateConfig(apiKey, engineConfig));
  }

  // 3. Explicit string name from options
  if (typeof engineOption === "string") {
    const entry = _registry.get(engineOption);
    if (!entry)
      throw new Error(
        `[agent-engine] Unknown engine: "${engineOption}". Registered: ${[..._registry.keys()].join(", ")}`,
      );
    assertAgentEnginePackageInstalled(entry);
    return entry.create(engineCreateConfig(apiKey));
  }

  // 4. Env var — explicit engine name override
  const envEngine = process.env.AGENT_ENGINE;
  if (envEngine) {
    const entry = _registry.get(envEngine);
    if (entry) {
      assertAgentEnginePackageInstalled(entry);
      return entry.create(engineCreateConfig(apiKey));
    }
  }

  const appDefault = await getAgentAppModelDefaultForCurrentRequest(appId);
  if (appDefault?.engine) {
    const entry = _registry.get(appDefault.engine);
    if (entry && (await isStoredEngineUsableForRequest(appDefault, entry))) {
      return entry.create(engineCreateConfig(apiKey));
    }
  }

  let stored: { engine?: unknown; config?: unknown } | null = null;
  try {
    stored = (await getSetting("agent-engine")) as typeof stored;
  } catch {
    // Settings not available — fall through
  }

  // 5. Auto-detect from the current user's per-user `app_secrets` rows
  // (Builder OAuth callback + "paste your own key" settings flow write
  // here, not env). Comes before env-detection so a user-specific
  // Builder connection wins over a stale deploy-level/provider key.
  const detectedFromUser = await detectEngineFromUserSecrets();
  if (detectedFromUser?.name === "builder") {
    return detectedFromUser.create(engineCreateConfig(apiKey));
  }

  // 6. Settings store — only when the stored row's API key is reachable.
  // This remains below Builder detection so "Builder.io connected" and the
  // runtime agree on the default managed gateway path. Non-Builder user keys
  // still honor the stored provider/model when Builder is not connected.
  const storedRaw = stored as { engine?: unknown; config?: unknown } | null;
  const storedEngine = storedRaw?.engine;
  const storedConfig = storedRaw?.config;
  if (storedRaw && typeof storedEngine === "string") {
    const entry = _registry.get(storedEngine);
    if (entry && (await isStoredEngineUsableForRequest(storedRaw, entry))) {
      return entry.create({
        ...engineCreateConfig(
          apiKey,
          stripInlineApiKeyConfig(
            storedConfig as Record<string, unknown> | undefined,
          ),
        ),
      });
    }
  }

  if (detectedFromUser) {
    return detectedFromUser.create(engineCreateConfig(apiKey));
  }

  // 8. Auto-detect from any provider env var — so just dropping a key in
  // .env works without also setting AGENT_ENGINE.
  const detected = canUseDeployCredentialFallbackForRequest()
    ? detectEngineFromEnv()
    : null;
  if (detected) return detected.create(engineCreateConfig(apiKey));

  // 9. Default: anthropic
  const anthropicEntry = _registry.get("anthropic");
  if (!anthropicEntry) {
    throw new Error(
      "[agent-engine] Default Anthropic engine is not registered. Did builtin.ts fail to load?",
    );
  }
  return anthropicEntry.create(engineCreateConfig(apiKey));
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
  options: { appId?: string } = {},
): Promise<string | undefined> {
  const engineName = typeof engine === "string" ? engine : engine.name;
  try {
    const appDefault = await getAgentAppModelDefaultForCurrentRequest(
      options.appId,
    );
    if (
      appDefault?.engine === engineName &&
      typeof appDefault.model === "string" &&
      appDefault.model.length > 0
    ) {
      return appDefault.model;
    }
  } catch {
    // Settings/request context may not be available — fall through.
  }

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
