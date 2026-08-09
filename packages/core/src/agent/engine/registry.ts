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

import {
  assertCredentialStoreReadable,
  canUseDeployCredentialFallbackForRequest,
  getBuilderCredentialAuthFailure,
  getProviderCredentialAuthFailure,
  readDeployCredentialEnv,
  resolveBuilderCredentialsDetailed,
  resolveSecret,
} from "../../server/credential-provider.js";
import { getSetting } from "../../settings/store.js";
import { getAgentAppModelDefaultForCurrentRequest } from "../app-model-defaults.js";
import {
  normalizeOpenAiBaseUrl,
  OLLAMA_BASE_URL_ENV_VAR,
  OPENAI_BASE_URL_ENV_VAR,
} from "./openai-compatible-endpoint.js";
import type { AgentEngine, EngineCapabilities } from "./types.js";

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

/**
 * True only when there is positive evidence this module is executing from a
 * bundled serverless function where optional dependencies were inlined into the
 * bundle and are therefore NOT resolvable via `require.resolve` — even though
 * the dynamic `import()` the engine uses to load them still works.
 *
 * Deliberately narrow. The Nitro Vercel/Netlify presets (which agent-native's
 * own `deploy` command emits) inline optional peers and always set these env
 * markers, so they are a reliable signal. Other serverless runtimes — a
 * container on Cloud Run / Google Cloud Functions (`K_SERVICE` /
 * `FUNCTION_TARGET`), or a plain AWS Lambda — commonly ship a real
 * `node_modules` where `require.resolve` is authoritative; there a resolve miss
 * means the package is genuinely absent and must NOT be masked. Those runtimes
 * are still covered *when the code is actually bundled*, via the module-path
 * check below, which stays false for a normal `node_modules` layout.
 */
function isBundledServerlessRuntime(): boolean {
  const env = process.env;
  // Nitro's Vercel/Netlify presets inline optional peers into the function
  // bundle; these platforms always set these markers.
  if (env.VERCEL || env.NETLIFY) return true;
  // Otherwise require direct evidence that this module is running from inside a
  // bundle output directory (Vercel's `/var/task`, Nitro's `.output/server`,
  // inlined `_libs`). This is the real signal that `require.resolve` cannot be
  // trusted; it stays false for normal `node_modules` layouts (dev, tests, and
  // container/Lambda/Cloud Run deploys that ship their dependencies), so a
  // genuine "package not installed" miss still surfaces there.
  try {
    return /[\\/](?:_libs|\.vercel|\.netlify|\.output)[\\/]|\/var\/task\//.test(
      import.meta.url ?? "",
    );
  } catch {
    return false;
  }
}

function canResolvePackage(packageName: string): boolean {
  const cached = _packageAvailabilityCache.get(packageName);
  if (cached !== undefined) return cached;
  let available = false;
  try {
    require.resolve(packageName);
    available = true;
  } catch {
    // Bundled serverless runtimes (e.g. Nitro on Vercel/Netlify) inline optional
    // provider packages into the function bundle, so require.resolve cannot find
    // them even though the dynamic `import()` the engine actually uses to load
    // them works. Treat them as available there and let the engine's own import
    // be the real gate — it already fails with a clear "pnpm add …" message when
    // the package is genuinely missing. Without this, every engine-usability
    // gate rejects the AI-SDK engines at runtime and the agent silently falls
    // back to the native Anthropic engine.
    available = isBundledServerlessRuntime();
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

interface ParsedVersionedModelId {
  family: string;
  version: number[];
  suffix: string;
}

function parseVersionedModelId(model: string): ParsedVersionedModelId | null {
  const match =
    /^(?<family>.+?)[-.](?<version>\d+(?:[-.]\d+)*)(?<suffix>(?:[-.][a-z][a-z0-9]*)*)$/i.exec(
      model.trim().toLowerCase(),
    );
  const groups = match?.groups;
  if (!groups?.family || !groups.version) return null;

  const version = groups.version.split(/[-.]/).map((part) => Number(part));
  if (version.some((part) => !Number.isSafeInteger(part))) return null;

  return {
    family: groups.family,
    version,
    suffix: groups.suffix ?? "",
  };
}

function compareModelVersions(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function findLatestSupportedVersionMatch(
  candidate: string,
  supportedModels: readonly string[],
): string | undefined {
  const parsedCandidate = parseVersionedModelId(candidate);
  if (!parsedCandidate) return undefined;

  let best: { model: string; version: number[] } | undefined;
  for (const supportedModel of supportedModels) {
    const parsedSupported = parseVersionedModelId(supportedModel);
    if (!parsedSupported) continue;
    if (parsedSupported.family !== parsedCandidate.family) continue;
    if (parsedSupported.suffix !== parsedCandidate.suffix) continue;
    if (
      best &&
      compareModelVersions(parsedSupported.version, best.version) <= 0
    ) {
      continue;
    }
    best = { model: supportedModel, version: parsedSupported.version };
  }

  return best?.model;
}

export interface NormalizeModelOptions {
  /**
   * Force unrecognized (custom) model IDs to be kept verbatim, as if
   * `engine.preserveCustomModels` were set on a live engine instance.
   *
   * The settings actions call `normalizeModelForEngine` with a static registry
   * ENTRY, which never carries the runtime `preserveCustomModels` flag — that
   * is only set on the engine INSTANCE created with an OpenAI-compatible
   * `baseUrl`. They resolve the capability with
   * {@link resolveEnginePreservesCustomModels} and pass it here so a gateway
   * model (e.g. an Ollama `gemma4`) is not rewritten to the OpenAI default on
   * save/read. First-party OpenAI (no gateway) leaves this unset, so an unknown
   * or invalid model still normalizes to a supported one.
   */
  preserveCustomModels?: boolean;
}

export function normalizeModelForEngine(
  engine: Pick<
    AgentEngine,
    "name" | "defaultModel" | "supportedModels" | "preserveCustomModels"
  >,
  model: string | null | undefined,
  options: NormalizeModelOptions = {},
): string {
  const candidate = typeof model === "string" ? model.trim() : "";
  if (!candidate) return engine.defaultModel;

  // Preserve custom IDs verbatim BEFORE any catalog/version matching, so a
  // version-shaped gateway model that happens to share a family with a
  // built-in model (e.g. `gpt-5.4` on an OpenAI-compatible endpoint) is not
  // rewritten to a catalog entry.
  if (engine.preserveCustomModels || options.preserveCustomModels) {
    return candidate;
  }

  if (engine.supportedModels.length === 0) return candidate;

  if (candidate === "auto" || engine.supportedModels.includes(candidate)) {
    return candidate;
  }

  return (
    findLatestSupportedVersionMatch(candidate, engine.supportedModels) ??
    engine.defaultModel
  );
}

type ModelResolvableEngine = Pick<
  AgentEngine,
  "name" | "defaultModel" | "supportedModels" | "preserveCustomModels"
>;

/**
 * Bound an untrusted, caller-supplied model preference to this engine's own
 * catalog. Returns `undefined` — never a substitute — when the hint names
 * anything the engine does not already offer, so a peer can never move the run
 * to a different provider, an unknown id, or a capability tier this engine was
 * not going to serve on its own.
 */
function resolveModelHintForEngine(
  engine: ModelResolvableEngine,
  hint: string | null | undefined,
): string | undefined {
  const candidate = typeof hint === "string" ? hint.trim() : "";
  if (!candidate || candidate === "auto") return undefined;
  // An engine with no catalog, or one that passes custom ids through verbatim
  // (an OpenAI-compatible gateway), cannot prove membership — so it takes no
  // hint at all rather than forwarding an unverifiable id to a provider.
  if (engine.preserveCustomModels || engine.supportedModels.length === 0) {
    return undefined;
  }
  const normalized = normalizeModelForEngine(engine, candidate);
  // `normalizeModelForEngine` answers `defaultModel` both for "this IS the
  // default" and for "no idea what this is", so an unmatched hint is only
  // distinguishable by re-checking the raw candidate. Anything else it returns
  // is a real catalog hit.
  const matched =
    normalized === engine.defaultModel
      ? engine.supportedModels.includes(candidate)
      : engine.supportedModels.includes(normalized);
  return matched ? normalized : undefined;
}

/**
 * Model for a delegated (A2A) run, in strict precedence: the receiving app's
 * explicit configuration, then its own stored setting, then the caller's hint,
 * then the engine default. An app that pins a model keeps it; a hint only fills
 * the gap where the receiver would otherwise take a default it never chose.
 *
 * A rejected hint is logged and dropped — a delegated run must never fail over
 * a preference.
 */
export function resolveDelegatedRunModel(
  engine: ModelResolvableEngine,
  options: {
    explicitModel?: string | null;
    storedModel?: string | null;
    callerModelHint?: string | null;
  },
): string {
  const own = options.explicitModel ?? options.storedModel;
  if (own) return normalizeModelForEngine(engine, own);
  const hinted = resolveModelHintForEngine(engine, options.callerModelHint);
  if (!hinted && options.callerModelHint) {
    console.log(
      `[a2a] Ignoring caller model hint "${options.callerModelHint}" — not offered by engine ${engine.name}`,
    );
  }
  return normalizeModelForEngine(engine, hinted ?? engine.defaultModel);
}

/**
 * Whether models saved or read for this engine ENTRY should be preserved
 * verbatim instead of normalized against the built-in catalog.
 *
 * `normalizeModelForEngine` honors a live engine's `preserveCustomModels`, but
 * that flag is only set on an AI SDK engine INSTANCE when the provider is
 * Ollama, or when OpenAI is pointed at an OpenAI-compatible gateway (a custom
 * base URL — e.g. Ollama Cloud or LiteLLM), whose model IDs are not in the
 * built-in catalogs.
 * The static registry entry the settings actions pass to
 * `normalizeModelForEngine` cannot carry that runtime flag, so this async
 * helper reproduces the same decision from the request's stored/deploy config.
 * Ollama always returns true because its local model inventory is user-defined;
 * first-party OpenAI (no gateway) returns false so an unknown/invalid model
 * still normalizes to a supported one.
 */
export async function resolveEnginePreservesCustomModels(
  entry: Pick<AgentEngineEntry, "name">,
): Promise<boolean> {
  if (entry.name === "ai-sdk:ollama") return true;
  if (entry.name !== "ai-sdk:openai") return false;
  try {
    return Boolean(await resolveProviderBaseUrl(OPENAI_BASE_URL_ENV_VAR));
  } catch {
    return false;
  }
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
 *
 * This sync helper is for CLI/status callers that cannot await settings. Prefer
 * {@link detectEngineFromEnvForRequest} at request time so sticky auth-failure
 * markers can skip rejected deploy keys.
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
      if (
        entry.requiredEnvVars.every(
          (v) =>
            canUseDeployCredentialFallbackForRequest(v) &&
            !!readDeployCredentialEnv(v),
        )
      ) {
        return entry;
      }
    }
    // No BYO key matched — fall through to include Builder as fallback.
  }

  for (const entry of _registry.values()) {
    if (entry.requiredEnvVars.length === 0) continue;
    if (!isAgentEnginePackageInstalled(entry)) continue;
    if (
      entry.requiredEnvVars.every(
        (v) =>
          canUseDeployCredentialFallbackForRequest(v) &&
          !!readDeployCredentialEnv(v),
      )
    ) {
      return entry;
    }
  }
  return null;
}

async function envKeyUsableForEntry(key: string): Promise<boolean> {
  if (
    !(
      canUseDeployCredentialFallbackForRequest(key) &&
      !!readDeployCredentialEnv(key)
    )
  ) {
    return false;
  }
  const value = readDeployCredentialEnv(key);
  if (!value) return false;
  return !(await getProviderCredentialAuthFailure({ key, value }));
}

/**
 * Builder's deploy-env fallback is checked as a pair, not per-key: the
 * auth-failure marker is fingerprinted from privateKey+publicKey together
 * (see `builderCredentialFingerprint`), so a single-key lookup can never
 * match it. Without this, a rejected deploy-level Builder key would keep
 * reporting "usable" through this env-only path forever — the same class of
 * bug as the per-scope check in `credential-provider.ts`'s
 * `isCompleteBuilderConnection`.
 */
async function hasUsableBuilderEnvKeys(): Promise<boolean> {
  const privateKey = canUseDeployCredentialFallbackForRequest(
    "BUILDER_PRIVATE_KEY",
  )
    ? readDeployCredentialEnv("BUILDER_PRIVATE_KEY")
    : null;
  const publicKey = canUseDeployCredentialFallbackForRequest(
    "BUILDER_PUBLIC_KEY",
  )
    ? readDeployCredentialEnv("BUILDER_PUBLIC_KEY")
    : null;
  if (!privateKey || !publicKey) return false;
  return !(await getBuilderCredentialAuthFailure({ privateKey, publicKey }));
}

async function hasUsableEnvKeys(entry: AgentEngineEntry): Promise<boolean> {
  if (!isAgentEnginePackageInstalled(entry)) return false;
  if (entry.requiredEnvVars.length === 0) return false;
  if (entry.name === "builder") return hasUsableBuilderEnvKeys();
  for (const key of entry.requiredEnvVars) {
    if (!(await envKeyUsableForEntry(key))) return false;
  }
  return true;
}

/**
 * Request-aware env auto-detect. Same priority as {@link detectEngineFromEnv},
 * but skips provider keys that currently have an auth-failure marker so a
 * rejected deploy key does not permanently win selection and leave chat stuck
 * on `missing_credentials`.
 */
export async function detectEngineFromEnvForRequest(): Promise<AgentEngineEntry | null> {
  const preferByo = /^(1|true)$/i.test(
    process.env.AGENT_ENGINE_PREFER_BYO_KEY ?? "",
  );

  if (preferByo) {
    for (const entry of _registry.values()) {
      if (entry.name === "builder") continue;
      if (await hasUsableEnvKeys(entry)) return entry;
    }
  }

  for (const entry of _registry.values()) {
    if (await hasUsableEnvKeys(entry)) return entry;
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
    if (entry.name === "builder") return hasUsableBuilderConnection();
    for (const key of entry.requiredEnvVars) {
      // A throw here means the credential store could not be read. Let it
      // propagate: swallowing it reports "no provider connected" to a user
      // whose key is sitting in a row we simply failed to load.
      if (!(await resolveUsableProviderSecret(key))) return false;
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

function canUseDeployEnvForEntry(entry: AgentEngineEntry): boolean {
  if (entry.requiredEnvVars.length === 0) return true;
  return entry.requiredEnvVars.every((key) =>
    canUseDeployCredentialFallbackForRequest(key),
  );
}

function engineCreateConfig(
  entry: AgentEngineEntry,
  apiKey: string | undefined,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    apiKey,
    allowEnvFallback: canUseDeployEnvForEntry(entry),
    ...(extra ?? {}),
  };
}

async function resolveProviderBaseUrl(
  envVar: string,
): Promise<string | undefined> {
  let raw: string | null | undefined = null;
  try {
    raw = await resolveSecret(envVar);
  } catch {
    raw = null;
  }

  if (!raw && canUseDeployCredentialFallbackForRequest(envVar)) {
    raw = readDeployCredentialEnv(envVar);
  }

  return raw ? normalizeOpenAiBaseUrl(raw) : undefined;
}

/**
 * A Builder connection we could not read is not a missing connection. Throwing
 * keeps that distinction instead of reporting "connect a provider" to a user
 * whose org-shared keys exist but were unreadable.
 */
async function hasUsableBuilderConnection(): Promise<boolean> {
  const creds = await resolveBuilderCredentialsDetailed();
  assertCredentialStoreReadable(creds);
  return Boolean(creds.privateKey && creds.publicKey);
}

async function resolveUsableProviderSecret(
  key: string,
): Promise<string | null> {
  const value = await resolveSecret(key);
  if (!value) return null;
  const authFailure = await getProviderCredentialAuthFailure({ key, value });
  return authFailure ? null : value;
}

/**
 * Return true only when the supplied key can be positively identified as a
 * usable credential for a different registered provider.
 *
 * `ResolveEngineConfig.apiKey` is public and may be an opaque caller-provided
 * key, so automatic selection must not silently replace it merely because a
 * stored credential also exists. Delegated/internal callers, however,
 * historically pass the current "active" provider key before the registry
 * selects an app-default engine. Exact in-memory comparison lets us correct
 * that proven mismatch without guessing from provider-specific key prefixes
 * or exposing either value.
 */
async function apiKeyBelongsToDifferentProvider(
  apiKey: string,
  selectedEntry: AgentEngineEntry,
): Promise<boolean> {
  const selectedEnvVars = new Set(selectedEntry.requiredEnvVars);
  const checkedEnvVars = new Set<string>();
  for (const entry of _registry.values()) {
    if (entry === selectedEntry || entry.name === "builder") continue;
    for (const key of entry.requiredEnvVars) {
      if (selectedEnvVars.has(key) || checkedEnvVars.has(key)) continue;
      checkedEnvVars.add(key);
      try {
        if ((await resolveUsableProviderSecret(key)) === apiKey) return true;
      } catch {
        // An unrelated provider store failure is not proof that the explicit
        // key belongs elsewhere. Preserve the caller's key and let the
        // selected provider's own preflight report any relevant failure.
      }
    }
  }
  return false;
}

async function engineCreateConfigForEntry(
  entry: AgentEngineEntry,
  apiKey: string | undefined,
  extra?: Record<string, unknown>,
  preferResolvedCredential = false,
  apiKeyEnvVar?: string,
): Promise<Record<string, unknown>> {
  const safeExtra = { ...(extra ?? {}) };
  let matchingApiKey = apiKey;
  // A declared provenance settles the question without inspecting values: a
  // credential issued for another provider's env var is never this entry's
  // key, so drop it on explicit branches too. Value comparison below cannot
  // cover this — a host-supplied key (plugin `options.apiKey`) matches no
  // stored secret, so it would otherwise reach whichever provider was picked.
  if (
    apiKeyEnvVar !== undefined &&
    !entry.requiredEnvVars.includes(apiKeyEnvVar)
  ) {
    matchingApiKey = undefined;
  }
  // Automatic engine selection must also select that engine's credential.
  // Callers historically passed one untagged "active" key before the registry
  // chose an engine, which could hand an Anthropic key to an app-default
  // OpenAI engine (or vice versa). Explicit engineOption branches retain their
  // paired key. Automatic branches replace only a key proven to belong to a
  // different configured provider; opaque caller-supplied keys keep the public
  // `ResolveEngineConfig.apiKey` contract.
  if (
    preferResolvedCredential &&
    entry.name !== "builder" &&
    entry.requiredEnvVars.length > 0
  ) {
    let resolvedMatchingCredential: string | undefined;
    let matchingCredentialUsesDeployFallback = false;
    for (const key of entry.requiredEnvVars) {
      const resolved = (await resolveUsableProviderSecret(key)) ?? undefined;
      if (!resolved) continue;
      resolvedMatchingCredential = resolved;
      matchingCredentialUsesDeployFallback =
        canUseDeployCredentialFallbackForRequest(key) &&
        readDeployCredentialEnv(key) === resolved;
      break;
    }

    const suppliedKeyMatchesSelected =
      matchingApiKey !== undefined &&
      matchingApiKey === resolvedMatchingCredential;
    const suppliedKeyBelongsElsewhere =
      matchingApiKey !== undefined &&
      !suppliedKeyMatchesSelected &&
      (await apiKeyBelongsToDifferentProvider(matchingApiKey, entry));

    if (matchingApiKey === undefined || suppliedKeyBelongsElsewhere) {
      // Keep deploy-only credentials implicit so provider SDKs retain their
      // established env-fallback behavior. Scoped credentials must be passed
      // explicitly. A proven different-provider key is replaced or cleared;
      // an opaque caller-supplied key is preserved by the branch above.
      matchingApiKey =
        resolvedMatchingCredential && !matchingCredentialUsesDeployFallback
          ? resolvedMatchingCredential
          : undefined;
    }
  }
  if (entry.name === "ai-sdk:openai" || entry.name === "ai-sdk:ollama") {
    if (typeof safeExtra.baseURL === "string" && safeExtra.baseUrl == null) {
      safeExtra.baseUrl = normalizeOpenAiBaseUrl(safeExtra.baseURL);
    }
    if (safeExtra.baseUrl == null) {
      const baseUrl = await resolveProviderBaseUrl(
        entry.name === "ai-sdk:ollama"
          ? OLLAMA_BASE_URL_ENV_VAR
          : OPENAI_BASE_URL_ENV_VAR,
      );
      if (baseUrl) safeExtra.baseUrl = baseUrl;
    }
  }
  return engineCreateConfig(entry, matchingApiKey, safeExtra);
}

/**
 * True when the stored `agent-engine` row points at a registered engine
 * AND an API key for it is reachable via the engine's required env vars.
 * Inline keys on the global settings row are ignored; see
 * `isAgentEngineSettingConfigured`.
 *
 * Sync helper for CLI/status. Prefer {@link isStoredEngineUsableForRequest}
 * so sticky auth-failure markers are respected.
 */
export function isStoredEngineUsable(
  stored: unknown,
  entry: AgentEngineEntry,
): boolean {
  if (!isAgentEnginePackageInstalled(entry)) return false;
  if (isAgentEngineSettingConfigured(stored)) return true;
  if (entry.requiredEnvVars.length === 0) return true;
  return entry.requiredEnvVars.every(
    (v) =>
      canUseDeployCredentialFallbackForRequest(v) &&
      !!readDeployCredentialEnv(v),
  );
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
  if (entry.name === "builder") return hasUsableBuilderConnection();
  for (const key of entry.requiredEnvVars) {
    if (!(await resolveUsableProviderSecret(key))) return false;
  }
  return true;
}

/**
 * Request-aware credential preflight for an already-resolved engine instance.
 * `resolveEngine()` may still return a default or explicitly requested engine
 * object before credentials are actually usable; call this before starting a
 * user-visible run so missing providers fail immediately.
 */
export async function isResolvedEngineUsableForRequest(
  engine: AgentEngine,
  options: { apiKey?: string } = {},
): Promise<boolean> {
  const entry = _registry.get(engine.name);
  // Custom engines may have their own credential contract outside the core
  // registry metadata, so do not block them speculatively.
  if (!entry) return true;
  if (!isAgentEnginePackageInstalled(entry)) return false;
  if (entry.requiredEnvVars.length === 0) return true;

  if (entry.name === "builder") return hasUsableBuilderConnection();

  if (options.apiKey?.trim()) {
    const key = entry.requiredEnvVars[0];
    if (!key) return true;
    return !(await getProviderCredentialAuthFailure({
      key,
      value: options.apiKey,
    }));
  }

  for (const key of entry.requiredEnvVars) {
    if (!(await resolveUsableProviderSecret(key))) return false;
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
  /**
   * Env var name `apiKey` was issued for, when the caller knows it. Declaring
   * it keeps a provider-specific credential from reaching a different
   * provider's engine; omit it for opaque keys.
   */
  apiKeyEnvVar?: string;
  /** Model override (used as part of engine config) */
  model?: string;
  /** App/template id used for org-scoped per-app model defaults. */
  appId?: string;
}

/**
 * Engine name a caller explicitly selected, when {@link resolveEngine} will
 * honor it as a name. Callers resolve the API key before they call
 * `resolveEngine`, so they need the same answer the registry will reach:
 * an untagged "active" key resolved against a different provider's setting
 * would otherwise ride along to whichever engine this names. Returns
 * `undefined` for an engine instance, which carries its own credential.
 */
export function explicitEngineName(
  engineOption: ResolveEngineConfig["engineOption"],
): string | undefined {
  if (!engineOption) return undefined;
  if (typeof engineOption === "string") return engineOption;
  if (
    typeof engineOption === "object" &&
    !("stream" in engineOption) &&
    typeof engineOption.name === "string"
  ) {
    return engineOption.name;
  }
  return undefined;
}

/**
 * Return the usable engine explicitly selected by the current user/org.
 *
 * This is intentionally narrower than {@link resolveEngine}: it only inspects
 * persisted app/global selections and does not auto-detect credentials or fall
 * back to deployment defaults. Callers that have their own configured fallback
 * (notably messaging integrations) can therefore honor the live request's
 * Agent settings before applying that fallback, while still resolving the API
 * key for the provider that was actually selected.
 */
export async function getConfiguredEngineNameForRequest(
  options: { appId?: string } = {},
): Promise<string | undefined> {
  const appDefault = await getAgentAppModelDefaultForCurrentRequest(
    options.appId,
  ).catch(() => null);
  if (appDefault?.engine) {
    const entry = _registry.get(appDefault.engine);
    if (entry && (await isStoredEngineUsableForRequest(appDefault, entry))) {
      return entry.name;
    }
  }

  let stored: { engine?: unknown; config?: unknown } | null = null;
  try {
    stored = (await getSetting("agent-engine")) as {
      engine?: unknown;
      config?: unknown;
    } | null;
  } catch {
    return undefined;
  }
  if (typeof stored?.engine !== "string") return undefined;
  const entry = _registry.get(stored.engine);
  if (!entry || !(await isStoredEngineUsableForRequest(stored, entry))) {
    return undefined;
  }
  return entry.name;
}

/**
 * Resolve an AgentEngine from options → explicit env → app default →
 * settings → request credentials → env → default.
 *
 * Resolution order:
 * 1. Explicit `engineOption` from plugin options (string name, instance, or {name, config})
 * 2. Env var AGENT_ENGINE
 * 3. Org/user app-template default, when usable
 * 4. Settings store key "agent-engine" → { engine: string }, when usable
 * 5. Current request's app_secrets; Builder wins by default when connected
 * 6. Auto-detect deployment env credentials
 * 7. Default "anthropic" (requires ANTHROPIC_API_KEY)
 */
export async function resolveEngine(
  config: ResolveEngineConfig,
): Promise<AgentEngine> {
  const { engineOption, apiKey, apiKeyEnvVar, model: _model, appId } = config;

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
    return entry.create(
      await engineCreateConfigForEntry(
        entry,
        apiKey,
        engineConfig,
        false,
        apiKeyEnvVar,
      ),
    );
  }

  // 3. Explicit string name from options
  if (typeof engineOption === "string") {
    const entry = _registry.get(engineOption);
    if (!entry)
      throw new Error(
        `[agent-engine] Unknown engine: "${engineOption}". Registered: ${[..._registry.keys()].join(", ")}`,
      );
    assertAgentEnginePackageInstalled(entry);
    return entry.create(
      await engineCreateConfigForEntry(
        entry,
        apiKey,
        undefined,
        false,
        apiKeyEnvVar,
      ),
    );
  }

  // 4. Env var — explicit engine name override
  const envEngine = process.env.AGENT_ENGINE;
  if (envEngine) {
    const entry = _registry.get(envEngine);
    if (entry) {
      assertAgentEnginePackageInstalled(entry);
      return entry.create(
        await engineCreateConfigForEntry(
          entry,
          apiKey,
          undefined,
          true,
          apiKeyEnvVar,
        ),
      );
    }
  }

  const appDefault = await getAgentAppModelDefaultForCurrentRequest(appId);
  if (appDefault?.engine) {
    const entry = _registry.get(appDefault.engine);
    if (entry && (await isStoredEngineUsableForRequest(appDefault, entry))) {
      return entry.create(
        await engineCreateConfigForEntry(
          entry,
          apiKey,
          undefined,
          true,
          apiKeyEnvVar,
        ),
      );
    }
  }

  let stored: { engine?: unknown; config?: unknown } | null = null;
  try {
    stored = (await getSetting("agent-engine")) as typeof stored;
  } catch {
    // Settings not available — fall through
  }

  // Auto-detect from the current user's per-user `app_secrets` rows
  // (Builder OAuth callback + "paste your own key" settings flow write here,
  // not env). Stored/app defaults are checked first so an explicit provider
  // selection can override a connected Builder account.
  const detectedFromUser = await detectEngineFromUserSecrets();

  // 6. Settings store — only when the stored row's API key is reachable.
  // This explicit selection beats automatic Builder detection so users can
  // switch away from Builder credits by saving/applying their own provider key.
  const storedRaw = stored as { engine?: unknown; config?: unknown } | null;
  const storedEngine = storedRaw?.engine;
  const storedConfig = storedRaw?.config;
  if (storedRaw && typeof storedEngine === "string") {
    const entry = _registry.get(storedEngine);
    if (entry && (await isStoredEngineUsableForRequest(storedRaw, entry))) {
      return entry.create(
        await engineCreateConfigForEntry(
          entry,
          apiKey,
          stripInlineApiKeyConfig(
            storedConfig as Record<string, unknown> | undefined,
          ),
          true,
          apiKeyEnvVar,
        ),
      );
    }
  }

  if (detectedFromUser) {
    return detectedFromUser.create(
      await engineCreateConfigForEntry(
        detectedFromUser,
        apiKey,
        undefined,
        true,
        apiKeyEnvVar,
      ),
    );
  }

  // 8. Auto-detect from any provider env var — so just dropping a key in
  // .env works without also setting AGENT_ENGINE. Skip keys with active
  // auth-failure markers so a rejected deploy key cannot permanently win.
  const detected = await detectEngineFromEnvForRequest();
  if (detected) {
    return detected.create(
      await engineCreateConfigForEntry(
        detected,
        apiKey,
        undefined,
        true,
        apiKeyEnvVar,
      ),
    );
  }

  // 9. Default: anthropic
  const anthropicEntry = _registry.get("anthropic");
  if (!anthropicEntry) {
    throw new Error(
      "[agent-engine] Default Anthropic engine is not registered. Did builtin.ts fail to load?",
    );
  }
  return anthropicEntry.create(
    await engineCreateConfigForEntry(
      anthropicEntry,
      apiKey,
      undefined,
      true,
      apiKeyEnvVar,
    ),
  );
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
