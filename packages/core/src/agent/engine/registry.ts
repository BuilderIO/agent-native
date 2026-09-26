
import { createRequire } from "node:module";

import { getAppConfig } from "../../app-config/index.js";
import {
  assertCredentialCanReachEndpoint,
  type CredentialProvenance,
} from "../../credentials/index.js";
import { isBlockedExtensionUrlWithDns } from "../../extensions/url-safety.js";
import { getUserLabs } from "../../labs/store.js";
import {
  BUILDER_OAUTH_SCOPE,
  hasBuilderOAuthSession,
  resolveBuilderOAuthRequestAccess,
} from "../../server/builder-oauth.js";
import { hasChatGPTSubscriptionCredential } from "../../server/chatgpt-subscription-oauth.js";
import {
  assertCredentialStoreReadable,
  canUseDeployCredentialFallbackForRequest,
  getBuilderCredentialAuthFailure,
  getProviderCredentialAuthFailure,
  isTrustedSelfHostedRuntime,
  prefetchSecrets,
  readDeployCredentialEnv,
  resolveBuilderCredentialsDetailed,
  resolveBuilderGatewayCredentialsDetailed,
  resolveSecretDetailed,
  type BuilderCredentialLookupIdentity,
} from "../../server/credential-provider.js";
import {
  getRequestOrgId,
  getRequestContext,
  getRequestUserEmail,
} from "../../server/request-context.js";
import { getSetting } from "../../settings/store.js";
import { getAgentAppModelDefaultForCurrentRequest } from "../app-model-defaults.js";
import {
  CHATGPT_SUBSCRIPTION_ENGINE_NAME,
  CHATGPT_SUBSCRIPTION_LAB_KEY,
} from "../chatgpt-subscription-contract.js";
import { createProviderEndpointFetch } from "./ai-sdk-engine.js";
import {
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_BASE_URL_ENV_VAR,
  OPENAI_BASE_URL_ENV_VAR,
  isCustomOpenAiBaseUrl,
} from "./openai-compatible-endpoint.js";
import {
  isLocalNetworkOllamaEndpoint,
  validateProviderBaseUrl,
} from "./provider-endpoint-validation.js";
import type { AgentEngine, EngineCapabilities } from "./types.js";

const require = createRequire(import.meta.url);

export interface AgentEngineEnvCredentialSet {
  envVars: string[];
  /**
   * Injected by a deploy pipeline rather than configured by the owner. Selects
   * when nothing else resolves, but never outranks an owner-configured
   * credential — including the legacy Builder pair, which keeps normal priority.
   */
  deployInjected?: boolean;
}

export interface AgentEngineEntry {
  name: string;
  label: string;
  description: string;
  installPackage?: string;
  capabilities: EngineCapabilities;
  defaultModel: string;
  supportedModels: readonly string[];
  acceptsCustomModels?: boolean;
  requiredEnvVars: string[];
  alternateRequiredEnvVars?: AgentEngineEnvCredentialSet[];
  create(config: Record<string, unknown>): AgentEngine;
}

const _registry = new Map<string, AgentEngineEntry>();
const _packageAvailabilityCache = new Map<string, boolean>();
const AGENT_NATIVE_BUILD_ENGINE_PACKAGES_ENV_VAR =
  "AGENT_NATIVE_BUILD_ENGINE_PACKAGES";

export function registerAgentEngine(entry: AgentEngineEntry): void {
  if (_registry.has(entry.name)) {
    if (process.env.NODE_ENV === "test") {
      _registry.delete(entry.name);
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

export function unregisterAgentEngine(name: string): void {
  _registry.delete(name);
}

export function getAgentEngineEntry(
  name: string,
): AgentEngineEntry | undefined {
  return _registry.get(name);
}

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

function isBundledServerlessRuntime(): boolean {
  const env = process.env;
  if (isLocalNetlifyRuntime()) return false;
  if (env.VERCEL || env.NETLIFY || env.NETLIFY_FUNCTION_NAME) return true;
  if (env.SITE_ID) return true; // guard:allow-env-credential - Netlify runtime host marker, not a credential.
  try {
    return /[\\/](?:_libs|\.vercel|\.netlify|\.output)[\\/]|\/var\/task\//.test(
      import.meta.url ?? "",
    );
  } catch {
    return false;
  }
}

function isLocalNetlifyRuntime(): boolean {
  const env = process.env;
  return (
    /^(1|true)$/i.test(env.NETLIFY_LOCAL ?? "") ||
    /^(1|true)$/i.test(env.NETLIFY_DEV ?? "")
  );
}

function resolveBuildBundledEnginePackages(): Set<string> | undefined {
  const marker = getAppConfig().agent.buildEnginePackages;
  if (marker === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(marker);
  } catch {
    throw new Error(
      `[agent-engine] ${AGENT_NATIVE_BUILD_ENGINE_PACKAGES_ENV_VAR} is not valid JSON.`,
    );
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((packageName) => typeof packageName !== "string")
  ) {
    throw new Error(
      `[agent-engine] ${AGENT_NATIVE_BUILD_ENGINE_PACKAGES_ENV_VAR} must be a JSON array of package names.`,
    );
  }
  return new Set(parsed);
}

function canResolvePackage(packageName: string): boolean {
  const cached = _packageAvailabilityCache.get(packageName);
  if (cached !== undefined) return cached;
  let available = false;
  try {
    require.resolve(packageName);
    available = true;
  } catch {
    const bundledPackages = isLocalNetlifyRuntime()
      ? undefined
      : resolveBuildBundledEnginePackages();
    if (bundledPackages) {
      available = bundledPackages.has(packageName);
    } else if (isBundledServerlessRuntime()) {
      available = true;
    }
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
  preserveCustomModels?: boolean;
  acceptsCustomModels?: boolean;
}

export function normalizeModelForEngine(
  engine: Pick<
    AgentEngine,
    | "name"
    | "defaultModel"
    | "supportedModels"
    | "acceptsCustomModels"
    | "preserveCustomModels"
  >,
  model: string | null | undefined,
  options: NormalizeModelOptions = {},
): string {
  const candidate = typeof model === "string" ? model.trim() : "";
  if (!candidate) return engine.defaultModel;

  if (
    engine.preserveCustomModels ||
    engine.acceptsCustomModels ||
    options.preserveCustomModels ||
    options.acceptsCustomModels
  ) {
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
  | "name"
  | "defaultModel"
  | "supportedModels"
  | "acceptsCustomModels"
  | "preserveCustomModels"
>;

function resolveModelHintForEngine(
  engine: ModelResolvableEngine,
  hint: string | null | undefined,
): string | undefined {
  const candidate = typeof hint === "string" ? hint.trim() : "";
  if (!candidate || candidate === "auto") return undefined;
  if (engine.preserveCustomModels || engine.supportedModels.length === 0) {
    return undefined;
  }
  const normalized = normalizeModelForEngine(engine, candidate);
  const matched =
    normalized === engine.defaultModel
      ? engine.supportedModels.includes(candidate)
      : engine.supportedModels.includes(normalized);
  return matched ? normalized : undefined;
}

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

export async function resolveEnginePreservesCustomModels(
  entry: Pick<AgentEngineEntry, "name">,
): Promise<boolean> {
  if (entry.name === "ai-sdk:ollama" || entry.name === "ai-sdk:openrouter") {
    return true;
  }
  if (entry.name !== "ai-sdk:openai") return false;
  try {
    return isCustomOpenAiBaseUrl(
      (await resolveProviderBaseUrl(OPENAI_BASE_URL_ENV_VAR))?.baseUrl,
    );
  } catch {
    return false;
  }
}

export async function resolveEngineAcceptsCustomModels(
  entry: Pick<AgentEngineEntry, "acceptsCustomModels">,
): Promise<boolean> {
  return entry.acceptsCustomModels === true;
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

interface EngineEnvCredentialSet {
  envVars: readonly string[];
  deployInjected: boolean;
}

function envCredentialSetsForEntry(
  entry: AgentEngineEntry,
): EngineEnvCredentialSet[] {
  const sets: EngineEnvCredentialSet[] = [];
  if (entry.requiredEnvVars.length > 0) {
    sets.push({ envVars: entry.requiredEnvVars, deployInjected: false });
  }
  for (const alternate of entry.alternateRequiredEnvVars ?? []) {
    if (alternate.envVars.length > 0) {
      sets.push({
        envVars: alternate.envVars,
        deployInjected: alternate.deployInjected === true,
      });
    }
  }
  return sets;
}

interface DetectedEngineEnvMatch {
  entry: AgentEngineEntry;
  /** True when the only credential that qualified it is deploy-injected. */
  deployInjected: boolean;
}

/**
 * Registration order decides, except that an injected set loses to any
 * owner-configured credential. Builder is registered first, so without that
 * exception an injected token would move a BYO customer onto Builder credits.
 */
function selectDetectedEngine(
  matches: readonly DetectedEngineEnvMatch[],
): AgentEngineEntry | null {
  return (
    matches.find((match) => !match.deployInjected)?.entry ??
    matches[0]?.entry ??
    null
  );
}

export function detectEngineFromEnv(): AgentEngineEntry | null {
  const preferByo = getAppConfig().agent.preferBringYourOwnKey;

  const matches: DetectedEngineEnvMatch[] = [];
  for (const entry of _registry.values()) {
    if (!isAgentEnginePackageInstalled(entry)) continue;
    const set = envCredentialSetsForEntry(entry).find((candidate) =>
      candidate.envVars.every(
        (v) =>
          canUseDeployCredentialFallbackForRequest(v) &&
          !!readDeployCredentialEnv(v),
      ),
    );
    if (set) matches.push({ entry, deployInjected: set.deployInjected });
  }

  if (preferByo) {
    const byo = matches.find((match) => match.entry.name !== "builder");
    if (byo) return byo.entry;
  }
  return selectDetectedEngine(matches);
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

const BUILDER_LEGACY_ENV_PAIR = ["BUILDER_PRIVATE_KEY", "BUILDER_PUBLIC_KEY"];

function isBuilderLegacyEnvPair(envVars: readonly string[]): boolean {
  return BUILDER_LEGACY_ENV_PAIR.every((key) => envVars.includes(key));
}

/**
 * The legacy pair's marker is fingerprinted from both keys together, so the
 * per-var lookup in {@link envKeyUsableForEntry} can never match it and a rejected
 * pair would report "usable" forever. Selected by credential shape, not engine
 * name: every other set carries a per-var marker already.
 */
async function hasUsableBuilderLegacyEnvPair(): Promise<boolean> {
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

async function isEnvCredentialSetUsable(
  set: EngineEnvCredentialSet,
): Promise<boolean> {
  const pairedCheck = isBuilderLegacyEnvPair(set.envVars);
  if (pairedCheck && !(await hasUsableBuilderLegacyEnvPair())) return false;
  for (const key of set.envVars) {
    if (pairedCheck && BUILDER_LEGACY_ENV_PAIR.includes(key)) continue;
    if (!(await envKeyUsableForEntry(key))) return false;
  }
  return true;
}

async function usableEnvCredentialMatch(
  entry: AgentEngineEntry,
): Promise<DetectedEngineEnvMatch | null> {
  if (!isAgentEnginePackageInstalled(entry)) return null;
  for (const set of envCredentialSetsForEntry(entry)) {
    if (await isEnvCredentialSetUsable(set)) {
      return { entry, deployInjected: set.deployInjected };
    }
  }
  return null;
}

export async function detectEngineFromEnvForRequest(): Promise<AgentEngineEntry | null> {
  const preferByo = getAppConfig().agent.preferBringYourOwnKey;

  const matches: DetectedEngineEnvMatch[] = [];
  for (const entry of _registry.values()) {
    const match = await usableEnvCredentialMatch(entry);
    if (match) matches.push(match);
  }

  if (preferByo) {
    const byo = matches.find((match) => match.entry.name !== "builder");
    if (byo) return byo.entry;
  }
  return selectDetectedEngine(matches);
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
export async function detectEngineFromUserSecrets(
  identity?: BuilderCredentialLookupIdentity,
): Promise<AgentEngineEntry | null> {
  const traceLookup = shouldTraceEngineDetection();
  let email = identity?.userEmail?.trim() || undefined;
  let orgId = identity?.orgId;
  try {
    const { getRequestUserEmail, getRequestOrgId } =
      await import("../../server/request-context.js");
    email ??= getRequestUserEmail();
    if (orgId === undefined) orgId = getRequestOrgId();
  } catch {
    if (!email) {
      if (traceLookup) {
        console.log(
          `[engine-detect] result=null reason=no-request-context email=(unknown) orgId=(unknown)`,
        );
      }
      return null;
    }
    if (traceLookup) {
      console.log(
        `[engine-detect] request context unavailable; using explicit identity email=${email} orgId=${orgId ?? "(none)"}`,
      );
    }
  }
  if (!email) {
    if (traceLookup) {
      console.log(
        `[engine-detect] result=null reason=no-email email=(empty) orgId=${orgId ?? "(none)"}`,
      );
    }
    return null;
  }

  const firstEntry = _registry.values().next().value;
  if (
    !getAppConfig().agent.preferBringYourOwnKey &&
    firstEntry?.name === "builder" &&
    isAgentEnginePackageInstalled(firstEntry) &&
    firstEntry.requiredEnvVars.length > 0 &&
    (await hasUsableBuilderConnection(identity))
  ) {
    return firstEntry;
  }

  // would put four scope reads in front of the fast path on a continuously
  let secretsPrefetched = false;
  const prefetchCandidateSecrets = async (): Promise<void> => {
    if (secretsPrefetched) return;
    secretsPrefetched = true;
    await prefetchSecrets([
      ...new Set(
        [..._registry.values()]
          .filter(
            (entry) =>
              entry.name !== "builder" && isAgentEnginePackageInstalled(entry),
          )
          .flatMap((entry) => entry.requiredEnvVars),
      ),
    ]);
  };

  const hasAllKeys = async (entry: AgentEngineEntry): Promise<boolean> => {
    if (!isAgentEnginePackageInstalled(entry)) return false;
    if (entry.requiredEnvVars.length === 0) return false;
    if (entry.name === "builder") {
      return hasUsableBuilderConnection(identity);
    }
    await prefetchCandidateSecrets();
    for (const key of entry.requiredEnvVars) {
      if (!(await resolveUsableProviderSecret(key))) return false;
    }
    return true;
  };

  const preferByo = getAppConfig().agent.preferBringYourOwnKey;
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

interface ResolvedProviderBaseUrl {
  baseUrl: string;
  allowedPrivateOrigin?: string;
  endpointOwner: { scope: string; scopeId?: string };
}

async function resolveProviderBaseUrl(
  envVar: string,
): Promise<ResolvedProviderBaseUrl | undefined> {
  const isOllama = envVar === OLLAMA_BASE_URL_ENV_VAR;
  const resolved = await resolveSecretDetailed(envVar);
  const raw = resolved.value;
  const deployValue = canUseDeployCredentialFallbackForRequest(envVar)
    ? readDeployCredentialEnv(envVar)
    : undefined;

  if (!raw) {
    assertCredentialStoreReadable(resolved);
    if (!deployValue) return undefined;
    const baseUrl = await validateProviderBaseUrl(deployValue, {
      allowPrivate: true,
      isOllama,
    });
    return {
      baseUrl,
      allowedPrivateOrigin: (await isBlockedExtensionUrlWithDns(baseUrl))
        ? new URL(baseUrl).origin
        : undefined,
      endpointOwner: { scope: "deployment" },
    };
  }

  const isDeployValue = deployValue !== undefined && raw === deployValue;
  const endpointOwner = resolved.source
    ? {
        scope: resolved.source === "env" ? "deployment" : resolved.source,
        scopeId: resolved.scopeId,
      }
    : { scope: "unknown" };
  const allowLocalOllama = isOllama && isTrustedSelfHostedRuntime();
  const baseUrl = await validateProviderBaseUrl(raw, {
    allowPrivate: isDeployValue,
    allowLocalOllama,
    isOllama,
  });
  const allowedPrivateOrigin =
    (isDeployValue ||
      (allowLocalOllama && isLocalNetworkOllamaEndpoint(baseUrl))) &&
    (await isBlockedExtensionUrlWithDns(baseUrl))
      ? new URL(baseUrl).origin
      : undefined;
  return { baseUrl, allowedPrivateOrigin, endpointOwner };
}

async function builderOAuthLaneUsable(
  identity?: BuilderCredentialLookupIdentity,
): Promise<boolean | null> {
  const ownerEmail =
    identity?.userEmail?.trim().toLowerCase() || getRequestUserEmail();
  const orgId =
    identity?.orgId !== undefined ? identity.orgId : getRequestOrgId();
  const requestOrgId = orgId ?? null;
  if (!ownerEmail || !(await hasBuilderOAuthSession(ownerEmail, requestOrgId)))
    return null;
  try {
    return Boolean(
      await resolveBuilderOAuthRequestAccess({
        ownerEmail,
        requiredScope: BUILDER_OAUTH_SCOPE,
        orgId: requestOrgId,
      }),
    );
  } catch {
    // coercion-ok: custody present but unusable is "not usable", not absent;
    return false;
  }
}

async function hasUsableBuilderConnection(
  identity?: BuilderCredentialLookupIdentity,
): Promise<boolean> {
  const oauthLane = await builderOAuthLaneUsable(identity);
  if (oauthLane !== null) return oauthLane;
  const creds = await resolveBuilderCredentialsDetailed(identity);
  assertCredentialStoreReadable(creds);
  return Boolean(creds.privateKey && creds.publicKey);
}

async function canRunBuilderEngine(
  identity?: BuilderCredentialLookupIdentity,
): Promise<boolean> {
  const oauthLane = await builderOAuthLaneUsable(identity);
  if (oauthLane !== null) return oauthLane;
  const creds = await resolveBuilderGatewayCredentialsDetailed(identity);
  assertCredentialStoreReadable(creds);
  return Boolean(creds.privateKey && creds.publicKey);
}

async function resolveUsableProviderSecret(
  key: string,
): Promise<string | null> {
  const resolved = await resolveUsableProviderSecretDetailed(key);
  if (!resolved) return null;
  return resolved.value;
}

async function resolveUsableProviderSecretDetailed(
  key: string,
): Promise<{ value: string; provenance: CredentialProvenance } | null> {
  const resolved = await resolveSecretDetailed(key);
  const value = resolved.value;
  if (!value) {
    assertCredentialStoreReadable(resolved);
    return null;
  }
  const authFailure = await getProviderCredentialAuthFailure({ key, value });
  if (authFailure) return null;
  const source = resolved.source;
  return {
    value,
    provenance: {
      scope: source === "env" ? "deployment" : (source ?? "deployment"),
      ...(resolved.scopeId ? { scopeId: resolved.scopeId } : {}),
    },
  };
}

function identityUserEmail(
  identity?: BuilderCredentialLookupIdentity,
): string | undefined {
  const explicit = identity?.userEmail?.trim();
  if (explicit) return explicit;
  return getRequestUserEmail()?.trim() || undefined;
}

async function chatGPTSubscriptionUsableForRequest(
  identity?: BuilderCredentialLookupIdentity,
): Promise<boolean> {
  const email = identityUserEmail(identity);
  if (!email) return false;
  const labs = await getUserLabs(email);
  if (labs[CHATGPT_SUBSCRIPTION_LAB_KEY] !== true) return false;
  return hasChatGPTSubscriptionCredential(email);
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

type CredentialResolutionMode = "explicit" | "automatic";

async function engineCreateConfigForEntry(
  entry: AgentEngineEntry,
  apiKey: string | undefined,
  extra?: Record<string, unknown>,
  credentialResolution: CredentialResolutionMode = "explicit",
  apiKeyEnvVar?: string,
  credentialIdentity?: BuilderCredentialLookupIdentity,
  apiKeyProvenance?: CredentialProvenance,
): Promise<Record<string, unknown>> {
  const safeExtra = { ...(extra ?? {}) };
  if (entry.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME) {
    const email = identityUserEmail(credentialIdentity);
    if (
      !email ||
      !(await chatGPTSubscriptionUsableForRequest(credentialIdentity))
    ) {
      throw new Error(
        "Enable the ChatGPT subscription lab and connect a ChatGPT subscription before using this engine.",
      );
    }
    safeExtra.userEmail = email;
  }
  let matchingApiKey = apiKey;
  let matchingApiKeyProvenance = apiKeyProvenance;
  if (
    matchingApiKey === undefined &&
    typeof safeExtra.apiKey === "string" &&
    safeExtra.apiKey.trim()
  ) {
    matchingApiKey = safeExtra.apiKey;
    matchingApiKeyProvenance = undefined;
  }
  // credential issued for another provider's env var is never this entry's
  // stored secret, so it would otherwise reach whichever provider was picked.
  if (
    apiKeyEnvVar !== undefined &&
    !entry.requiredEnvVars.includes(apiKeyEnvVar)
  ) {
    matchingApiKey = undefined;
    matchingApiKeyProvenance = undefined;
  }
  // Engine selection must also select that engine's credential. Callers
  if (
    (credentialResolution === "automatic" || matchingApiKey === undefined) &&
    entry.name !== "builder" &&
    entry.requiredEnvVars.length > 0
  ) {
    let resolvedMatchingCredential:
      | { value: string; provenance: CredentialProvenance }
      | undefined;
    let matchingCredentialUsesDeployFallback = false;
    for (const key of entry.requiredEnvVars) {
      const resolved =
        (await resolveUsableProviderSecretDetailed(key)) ?? undefined;
      if (!resolved) continue;
      resolvedMatchingCredential = resolved;
      matchingCredentialUsesDeployFallback =
        canUseDeployCredentialFallbackForRequest(key) &&
        readDeployCredentialEnv(key) === resolved.value;
      break;
    }

    const suppliedKeyMatchesSelected =
      matchingApiKey !== undefined &&
      matchingApiKey === resolvedMatchingCredential?.value;
    const suppliedKeyBelongsElsewhere =
      matchingApiKey !== undefined &&
      !suppliedKeyMatchesSelected &&
      (await apiKeyBelongsToDifferentProvider(matchingApiKey, entry));

    if (matchingApiKey === undefined || suppliedKeyBelongsElsewhere) {
      matchingApiKey =
        resolvedMatchingCredential && !matchingCredentialUsesDeployFallback
          ? resolvedMatchingCredential.value
          : undefined;
      matchingApiKeyProvenance = resolvedMatchingCredential?.provenance;
    } else if (suppliedKeyMatchesSelected) {
      matchingApiKeyProvenance ??= resolvedMatchingCredential?.provenance;
    }
  }
  const aiSdkProvider = entry.name.startsWith("ai-sdk:")
    ? entry.name.slice("ai-sdk:".length)
    : undefined;
  if (aiSdkProvider) {
    const isOllama = aiSdkProvider === "ollama";
    const allowLocalOllama = isOllama && isTrustedSelfHostedRuntime();
    let resolvedEndpoint: ResolvedProviderBaseUrl | undefined;
    if (safeExtra.baseUrl == null && typeof safeExtra.baseURL !== "string") {
      const envVar =
        aiSdkProvider === "ollama"
          ? OLLAMA_BASE_URL_ENV_VAR
          : aiSdkProvider === "openai"
            ? OPENAI_BASE_URL_ENV_VAR
            : undefined;
      if (envVar) resolvedEndpoint = await resolveProviderBaseUrl(envVar);
      if (resolvedEndpoint) safeExtra.baseUrl = resolvedEndpoint.baseUrl;
    }

    if (safeExtra.baseUrl == null && typeof safeExtra.baseURL === "string") {
      safeExtra.baseUrl = safeExtra.baseURL;
    }

    if (typeof safeExtra.baseUrl === "string") {
      const baseUrl = safeExtra.baseUrl;
      const endpointOwner =
        resolvedEndpoint?.endpointOwner ?? { scope: "deployment" };
      const validatedBaseUrl =
        resolvedEndpoint?.baseUrl ??
        (await validateProviderBaseUrl(baseUrl, {
          allowLocalOllama,
          isOllama,
        }));
      safeExtra.baseUrl = validatedBaseUrl;
      const allowedPrivateOrigin =
        resolvedEndpoint?.allowedPrivateOrigin ??
        (allowLocalOllama &&
        isLocalNetworkOllamaEndpoint(validatedBaseUrl) &&
        (await isBlockedExtensionUrlWithDns(validatedBaseUrl))
          ? new URL(validatedBaseUrl).origin
          : undefined);
      if (endpointOwner.scope !== "deployment") {
        safeExtra.allowEnvFallback = false;
      }
      if (matchingApiKey !== undefined || matchingApiKeyProvenance) {
        assertCredentialCanReachEndpoint(
          endpointOwner,
          matchingApiKeyProvenance,
          entry.requiredEnvVars[0],
        );
      }
      safeExtra.requestFetch = createProviderEndpointFetch(
        validatedBaseUrl,
        allowedPrivateOrigin ? [allowedPrivateOrigin] : [],
      );
    } else if (isOllama) {
      const allowedPrivateOrigins =
        isTrustedSelfHostedRuntime() &&
        isLocalNetworkOllamaEndpoint(OLLAMA_DEFAULT_BASE_URL)
          ? [new URL(OLLAMA_DEFAULT_BASE_URL).origin]
          : [];
      safeExtra.requestFetch = createProviderEndpointFetch(
        OLLAMA_DEFAULT_BASE_URL,
        allowedPrivateOrigins,
      );
    }
  }
  if (
    entry.name === "builder" &&
    (credentialIdentity !== undefined || safeExtra.credentials == null)
  ) {
    const creds =
      await resolveBuilderGatewayCredentialsDetailed(credentialIdentity);
    assertCredentialStoreReadable(creds);
    if (
      credentialIdentity !== undefined ||
      creds.source !== null ||
      creds.lookupFailed
    ) {
      safeExtra.credentials = {
        privateKey: creds.privateKey,
        publicKey: creds.publicKey,
        userId: creds.userId,
        orgName: creds.orgName,
        lane: creds.lane,
      };
    }
  }
  return engineCreateConfig(entry, matchingApiKey, safeExtra);
}

export function isStoredEngineUsable(
  stored: unknown,
  entry: AgentEngineEntry,
): boolean {
  if (!isAgentEnginePackageInstalled(entry)) return false;
  if (isAgentEngineSettingConfigured(stored)) return true;
  if (entry.requiredEnvVars.length === 0) return true;
  // Every credential set, not just `requiredEnvVars`. Reading only the latter
  const sets = envCredentialSetsForEntry(entry);
  if (sets.length === 0) return true;
  return sets.some((set) =>
    set.envVars.every(
      (v) =>
        canUseDeployCredentialFallbackForRequest(v) &&
        !!readDeployCredentialEnv(v),
    ),
  );
}

export async function isStoredEngineUsableForRequest(
  stored: unknown,
  entry: AgentEngineEntry,
  options: { credentialIdentity?: BuilderCredentialLookupIdentity } = {},
): Promise<boolean> {
  if (entry.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME) {
    return chatGPTSubscriptionUsableForRequest(options.credentialIdentity);
  }
  if (!isAgentEnginePackageInstalled(entry)) return false;
  if (isAgentEngineSettingConfigured(stored)) return true;
  if (entry.requiredEnvVars.length === 0) return true;
  if (entry.name === "builder") {
    return canRunBuilderEngine(options.credentialIdentity);
  }
  for (const key of entry.requiredEnvVars) {
    if (!(await resolveUsableProviderSecret(key))) return false;
  }
  return true;
}

export async function isResolvedEngineUsableForRequest(
  engine: AgentEngine,
  options: {
    apiKey?: string;
    credentialIdentity?: BuilderCredentialLookupIdentity;
  } = {},
): Promise<boolean> {
  const entry = _registry.get(engine.name);
  if (!entry) return true;
  if (entry.name === CHATGPT_SUBSCRIPTION_ENGINE_NAME) {
    return chatGPTSubscriptionUsableForRequest(options.credentialIdentity);
  }
  if (!isAgentEnginePackageInstalled(entry)) return false;
  if (entry.requiredEnvVars.length === 0) return true;

  if (entry.name === "builder") {
    return canRunBuilderEngine(options.credentialIdentity);
  }

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
  engineOption?:
    | string
    | AgentEngine
    | { name: string; config: Record<string, unknown> };
  apiKey?: string;
  apiKeyEnvVar?: string;
  apiKeyProvenance?: CredentialProvenance;
  model?: string;
  appId?: string;
  credentialIdentity?: BuilderCredentialLookupIdentity;
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

export async function resolveEngine(
  config: ResolveEngineConfig,
): Promise<AgentEngine> {
  const {
    engineOption,
    apiKey,
    apiKeyEnvVar,
    apiKeyProvenance,
    model: _model,
    appId,
    credentialIdentity,
  } = config;

  if (
    engineOption &&
    typeof engineOption === "object" &&
    "stream" in engineOption
  ) {
    return engineOption as AgentEngine;
  }

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
        "explicit",
        apiKeyEnvVar,
        credentialIdentity,
        apiKeyProvenance,
      ),
    );
  }

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
        "explicit",
        apiKeyEnvVar,
        credentialIdentity,
        apiKeyProvenance,
      ),
    );
  }

  const envEngine = getAppConfig().agent.engine;
  if (envEngine) {
    const entry = _registry.get(envEngine);
    if (entry) {
      assertAgentEnginePackageInstalled(entry);
      const canUseConfiguredEngine =
        getRequestContext()?.isSyntheticTraffic !== true ||
        (await isStoredEngineUsableForRequest({ engine: entry.name }, entry, {
          credentialIdentity,
        }));
      if (canUseConfiguredEngine) {
        return entry.create(
          await engineCreateConfigForEntry(
            entry,
            apiKey,
            undefined,
            "automatic",
            apiKeyEnvVar,
            credentialIdentity,
            apiKeyProvenance,
          ),
        );
      }
    }
  }

  const appDefault = await getAgentAppModelDefaultForCurrentRequest(appId);
  if (appDefault?.engine) {
    const entry = _registry.get(appDefault.engine);
    if (
      entry &&
      (await isStoredEngineUsableForRequest(appDefault, entry, {
        credentialIdentity,
      }))
    ) {
      return entry.create(
        await engineCreateConfigForEntry(
          entry,
          apiKey,
          undefined,
          "automatic",
          apiKeyEnvVar,
          credentialIdentity,
          apiKeyProvenance,
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

  const detectedFromUser =
    await detectEngineFromUserSecrets(credentialIdentity);

  const storedRaw = stored as { engine?: unknown; config?: unknown } | null;
  const storedEngine = storedRaw?.engine;
  const storedConfig = storedRaw?.config;
  if (storedRaw && typeof storedEngine === "string") {
    const entry = _registry.get(storedEngine);
    if (
      entry &&
      (await isStoredEngineUsableForRequest(storedRaw, entry, {
        credentialIdentity,
      }))
    ) {
      return entry.create(
        await engineCreateConfigForEntry(
          entry,
          apiKey,
          stripInlineApiKeyConfig(
            storedConfig as Record<string, unknown> | undefined,
          ),
          "automatic",
          apiKeyEnvVar,
          credentialIdentity,
          apiKeyProvenance,
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
        "automatic",
        apiKeyEnvVar,
        credentialIdentity,
        apiKeyProvenance,
      ),
    );
  }

  const detected = await detectEngineFromEnvForRequest();
  if (detected) {
    return detected.create(
      await engineCreateConfigForEntry(
        detected,
        apiKey,
        undefined,
        "automatic",
        apiKeyEnvVar,
        credentialIdentity,
        apiKeyProvenance,
      ),
    );
  }

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
      "automatic",
      apiKeyEnvVar,
      credentialIdentity,
      apiKeyProvenance,
    ),
  );
}

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
