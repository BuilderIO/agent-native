import {
  isCustomOpenAiBaseUrl,
  OLLAMA_BASE_URL_ENV_VAR,
  OPENAI_BASE_URL_ENV_VAR,
  OPENAI_DEFAULT_BASE_URL,
} from "../agent/engine/openai-compatible-endpoint.js";
import { validateProviderBaseUrl } from "../agent/engine/provider-endpoint-validation.js";
import { PROVIDER_ENV_META } from "../agent/engine/provider-env-vars.js";
import {
  AGENT_PROVIDER_CATALOG,
  type AgentProviderId,
} from "../client/agent-provider-catalog.js";
import { ssrfSafeFetch } from "../extensions/url-safety.js";
import { getOrgRoleForEmail } from "../mcp/actions/service-token-access.js";
import { canManageOrg } from "../org/permissions.js";
import { readAppSecret } from "../secrets/storage.js";
import {
  clearProviderCredentialAuthFailure,
  isTrustedSelfHostedRuntime,
  recordProviderCredentialAuthFailure,
  resolveSecretDetailed,
} from "./credential-provider.js";
import { getRequestOrgId, getRequestUserEmail } from "./request-context.js";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_MODEL_PAGES = 10;

export const PROVIDER_KEY_CHECK_PROVIDERS = AGENT_PROVIDER_CATALOG.map(
  (option) => option.id,
) as readonly AgentProviderId[];

/**
 * Why a check did not list models. `rejected` is the provider refusing the
 * key; `wrong-provider` is a key with another provider's prefix, refused
 * before it is sent anywhere; `unreachable` and `provider-error` say nothing
 * about the key itself.
 */
export type ProviderKeyCheckCode =
  | "rejected"
  | "wrong-provider"
  | "missing-key"
  | "invalid-endpoint"
  | "unreachable"
  | "provider-error";

export type ProviderKeyCheckResult =
  | {
      ok: true;
      provider: AgentProviderId;
      models: string[];
      /** More pages existed than one check reads; `models` is a prefix. */
      truncated?: true;
      checkedAt: number;
    }
  | {
      ok: false;
      provider: AgentProviderId;
      models: [];
      code: ProviderKeyCheckCode;
      /** English copy from the spec; clients localize from `code` instead. */
      reason: string;
      /** The provider's HTTP status, for `rejected` and `provider-error`. */
      status?: number;
      /** Set when a rejected key lacks the provider's documented prefix. */
      expectedPrefix?: string;
      /** The provider whose prefix a `wrong-provider` key carries. */
      detectedProvider?: AgentProviderId;
      checkedAt: number;
    };

export interface ProviderKeyCheckInput {
  provider: AgentProviderId;
  /** A pasted key. Omit to check the saved key. */
  key?: string;
  /**
   * OpenAI-compatible gateway or Ollama endpoint. `undefined` uses the saved
   * endpoint (the one a save without an endpoint keeps); `null` uses the
   * provider's default. Only with a pasted `key` (Ollama sends none): a saved
   * key only ever goes to its saved endpoint.
   */
  baseUrl?: string | null;
  /**
   * Which saved row to read when `key` and `baseUrl` are omitted. `org` is for
   * owners and admins only.
   */
  scope?: "user" | "org";
}

/** A request the check refuses before reading or sending anything. */
export class ProviderKeyCheckRequestError extends Error {
  readonly statusCode: 400 | 403;
  constructor(message: string, statusCode: 400 | 403) {
    super(message);
    this.name = "ProviderKeyCheckRequestError";
    this.statusCode = statusCode;
  }
}

const EXPECTED_PREFIX: Partial<Record<AgentProviderId, string>> = {
  anthropic: "sk-ant-",
  openai: "sk-",
  openrouter: "sk-or-",
  google: "AIza",
  groq: "gsk_",
};

// Only prefixes no other provider issues. `sk-` alone is shared by OpenAI,
// Anthropic, and OpenRouter, so it identifies nothing.
const DISTINCTIVE_PREFIXES: ReadonlyArray<[string, AgentProviderId]> = [
  ["sk-ant-", "anthropic"],
  ["sk-or-", "openrouter"],
  ["sk-proj-", "openai"],
  ["sk-svcacct-", "openai"],
  ["gsk_", "groq"],
  ["AIza", "google"],
];

// Official OpenAI and Groq lists include audio, image, embedding, and
// moderation models the chat picker can't run.
const NON_CHAT_MODEL =
  /(embed|whisper|tts|dall-e|davinci|babbage|moderation|transcribe|image|audio|realtime|sora|guard)/i;

function providerLabel(provider: AgentProviderId): string {
  return (
    AGENT_PROVIDER_CATALOG.find((option) => option.id === provider)?.label ??
    provider
  );
}

function withArticle(label: string): string {
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}

export function isProviderKeyCheckProvider(
  value: unknown,
): value is AgentProviderId {
  return (
    typeof value === "string" &&
    (PROVIDER_KEY_CHECK_PROVIDERS as readonly string[]).includes(value)
  );
}

export function providerForKeyEnvVar(envVar: string): AgentProviderId | null {
  for (const [provider, meta] of Object.entries(PROVIDER_ENV_META)) {
    if (meta.envVar === envVar && isProviderKeyCheckProvider(provider)) {
      return provider;
    }
  }
  return null;
}

/** The provider a key's prefix belongs to, when only one provider uses it. */
export function detectKeyProvider(key: string): AgentProviderId | null {
  const match = DISTINCTIVE_PREFIXES.find(([prefix]) => key.startsWith(prefix));
  return match ? match[1] : null;
}

/** The headline a UI shows above a `rejected` or `wrong-provider` reason. */
export function providerKeyRejectedHeadline(provider: AgentProviderId): string {
  return `${providerLabel(provider)} rejected this key.`;
}

function failure(
  provider: AgentProviderId,
  code: ProviderKeyCheckCode,
  reason: string,
  extra: {
    status?: number;
    expectedPrefix?: string;
    detectedProvider?: AgentProviderId;
  } = {},
): ProviderKeyCheckResult {
  return {
    ok: false,
    provider,
    models: [],
    code,
    reason,
    ...extra,
    checkedAt: Date.now(),
  };
}

function rejected(
  provider: AgentProviderId,
  key: string,
  status: number,
  gateway: boolean,
): ProviderKeyCheckResult {
  const prefix = gateway ? undefined : EXPECTED_PREFIX[provider];
  if (prefix && !key.startsWith(prefix)) {
    return failure(
      provider,
      "rejected",
      `${providerLabel(provider)} keys start with ${prefix}.`,
      { status, expectedPrefix: prefix },
    );
  }
  return failure(provider, "rejected", providerKeyRejectedHeadline(provider), {
    status,
  });
}

type FetchOutcome =
  | { kind: "ok"; body: unknown }
  | { kind: "http"; status: number; body: unknown }
  | { kind: "unreachable" };

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  userEndpoint?: { allowedPrivateOrigins: string[] },
): Promise<FetchOutcome> {
  let response: Response;
  try {
    const init: RequestInit = {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    // A request-supplied endpoint goes through the SSRF guard on every hop;
    // the fixed provider hosts below are public and constant.
    response = userEndpoint
      ? await ssrfSafeFetch(url, init, userEndpoint)
      : await fetch(url, init);
  } catch {
    return { kind: "unreachable" };
  }
  // Provider error bodies can echo part of the key, so they are only parsed
  // for machine-readable fields and never returned.
  // coercion-ok: an unparseable body is only consulted for rejection hints.
  const body = await response.json().catch(() => null);
  return response.ok
    ? { kind: "ok", body }
    : { kind: "http", status: response.status, body };
}

interface ModelPage {
  models: string[];
  next?: string;
}

interface ProviderListing {
  firstUrl: string;
  headers: Record<string, string>;
  parse(body: unknown): ModelPage;
  isRejection(status: number, body: unknown): boolean;
  userEndpoint?: { allowedPrivateOrigins: string[] };
  gateway?: boolean;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === "object",
      )
    : [];
}

function field(body: unknown, name: string): unknown {
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)[name]
    : undefined;
}

function stringField(entry: Record<string, unknown>, name: string): string {
  const value = entry[name];
  return typeof value === "string" ? value.trim() : "";
}

function withQuery(url: string, name: string, value: string): string {
  const next = new URL(url);
  next.searchParams.set(name, value);
  return next.toString();
}

const isAuthStatus = (status: number) => status === 401 || status === 403;

function openAiStyleListing(
  url: string,
  key: string,
  options: {
    filterNonChat: boolean;
    userEndpoint?: { allowedPrivateOrigins: string[] };
    gateway?: boolean;
  },
): ProviderListing {
  return {
    firstUrl: url,
    headers: { Authorization: `Bearer ${key}` },
    parse: (body) => ({
      models: records(field(body, "data"))
        .filter((entry) => entry.active !== false)
        .map((entry) => stringField(entry, "id"))
        .filter(
          (id) => id && !(options.filterNonChat && NON_CHAT_MODEL.test(id)),
        ),
    }),
    isRejection: isAuthStatus,
    ...(options.userEndpoint ? { userEndpoint: options.userEndpoint } : {}),
    ...(options.gateway ? { gateway: true } : {}),
  };
}

function listingFor(
  provider: Exclude<AgentProviderId, "ollama" | "openrouter">,
  key: string,
  openAiBaseUrl: string | null,
): ProviderListing {
  switch (provider) {
    case "anthropic": {
      const firstUrl = "https://api.anthropic.com/v1/models?limit=1000";
      return {
        firstUrl,
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        parse: (body) => {
          const lastId = field(body, "last_id");
          return {
            models: records(field(body, "data")).map((entry) =>
              stringField(entry, "id"),
            ),
            ...(field(body, "has_more") === true && typeof lastId === "string"
              ? { next: withQuery(firstUrl, "after_id", lastId) }
              : {}),
          };
        },
        isRejection: isAuthStatus,
      };
    }
    case "openai":
      return openAiBaseUrl
        ? openAiStyleListing(`${openAiBaseUrl}/models`, key, {
            filterNonChat: false,
            userEndpoint: { allowedPrivateOrigins: [] },
            gateway: true,
          })
        : openAiStyleListing(`${OPENAI_DEFAULT_BASE_URL}/models`, key, {
            filterNonChat: true,
          });
    case "groq":
      return openAiStyleListing("https://api.groq.com/openai/v1/models", key, {
        filterNonChat: true,
      });
    case "mistral":
      return {
        firstUrl: "https://api.mistral.ai/v1/models",
        headers: { Authorization: `Bearer ${key}` },
        parse: (body) => ({
          models: records(field(body, "data"))
            .filter((entry) => {
              const capabilities = entry.capabilities;
              return !(
                capabilities &&
                typeof capabilities === "object" &&
                (capabilities as Record<string, unknown>).completion_chat ===
                  false
              );
            })
            .map((entry) => stringField(entry, "id")),
        }),
        isRejection: isAuthStatus,
      };
    case "cohere": {
      const firstUrl =
        "https://api.cohere.com/v1/models?endpoint=chat&page_size=1000";
      return {
        firstUrl,
        headers: { Authorization: `Bearer ${key}` },
        parse: (body) => {
          const token = field(body, "next_page_token");
          return {
            models: records(field(body, "models")).map((entry) =>
              stringField(entry, "name"),
            ),
            ...(typeof token === "string" && token
              ? { next: withQuery(firstUrl, "page_token", token) }
              : {}),
          };
        },
        isRejection: isAuthStatus,
      };
    }
    case "google": {
      const firstUrl =
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";
      return {
        firstUrl,
        // Header, not `?key=`: a key in the URL ends up in proxy logs.
        headers: { "x-goog-api-key": key },
        parse: (body) => {
          const token = field(body, "nextPageToken");
          return {
            models: records(field(body, "models"))
              .filter((entry) => {
                const methods = entry.supportedGenerationMethods;
                return (
                  !Array.isArray(methods) || methods.includes("generateContent")
                );
              })
              .map((entry) =>
                stringField(entry, "name").replace(/^models\//, ""),
              ),
            ...(typeof token === "string" && token
              ? { next: withQuery(firstUrl, "pageToken", token) }
              : {}),
          };
        },
        // Google answers a malformed or unknown key with 400 API_KEY_INVALID.
        isRejection: (status, body) =>
          isAuthStatus(status) ||
          (status === 400 && JSON.stringify(body ?? "").includes("API_KEY")),
      };
    }
  }
}

async function listModels(
  provider: AgentProviderId,
  key: string,
  listing: ProviderListing,
): Promise<ProviderKeyCheckResult> {
  const label = providerLabel(provider);
  const models: string[] = [];
  let url: string | undefined = listing.firstUrl;
  for (let page = 0; url && page < MAX_MODEL_PAGES; page++) {
    const outcome = await fetchJson(url, listing.headers, listing.userEndpoint);
    if (outcome.kind === "unreachable") {
      return failure(provider, "unreachable", `Couldn't reach ${label}.`);
    }
    if (outcome.kind === "http") {
      if (listing.isRejection(outcome.status, outcome.body)) {
        return rejected(provider, key, outcome.status, !!listing.gateway);
      }
      return failure(
        provider,
        "provider-error",
        `${label} couldn't check this key right now. Try again in a moment.`,
        { status: outcome.status },
      );
    }
    const parsed = listing.parse(outcome.body);
    models.push(...parsed.models);
    url = parsed.next;
  }
  return {
    ok: true,
    provider,
    models: [...new Set(models.filter(Boolean))],
    ...(url ? { truncated: true as const } : {}),
    checkedAt: Date.now(),
  };
}

async function listOpenRouterModels(
  key: string,
): Promise<ProviderKeyCheckResult> {
  // The model list is public, so only the key endpoint proves the key works.
  const [keyCheck, listed] = await Promise.all([
    fetchJson("https://openrouter.ai/api/v1/key", {
      Authorization: `Bearer ${key}`,
    }),
    listModels(
      "openrouter",
      key,
      openAiStyleListing("https://openrouter.ai/api/v1/models", key, {
        filterNonChat: false,
      }),
    ),
  ]);
  if (keyCheck.kind === "unreachable") {
    return failure("openrouter", "unreachable", "Couldn't reach OpenRouter.");
  }
  if (keyCheck.kind === "http") {
    return isAuthStatus(keyCheck.status)
      ? rejected("openrouter", key, keyCheck.status, false)
      : failure(
          "openrouter",
          "provider-error",
          "OpenRouter couldn't check this key right now. Try again in a moment.",
          { status: keyCheck.status },
        );
  }
  return listed;
}

async function listOllamaModels(
  baseUrl: string,
  trusted: boolean,
): Promise<ProviderKeyCheckResult> {
  const outcome = await fetchJson(
    `${baseUrl}/api/tags`,
    {},
    // Same allowance `validateProviderBaseUrl` just granted; see the Ollama
    // models route for why the fetch needs it again.
    { allowedPrivateOrigins: trusted ? [baseUrl] : [] },
  );
  if (outcome.kind !== "ok") {
    return failure("ollama", "unreachable", "Couldn't reach Ollama.", {
      ...(outcome.kind === "http" ? { status: outcome.status } : {}),
    });
  }
  return {
    ok: true,
    provider: "ollama",
    models: [
      ...new Set(
        records(field(outcome.body, "models"))
          .map((entry) => stringField(entry, "name"))
          .filter(Boolean),
      ),
    ],
    checkedAt: Date.now(),
  };
}

/**
 * A saved row, or null when none is saved. Deployment environment values are
 * never read: they are not the caller's key. Throws when the store can't be
 * read, so "unreadable" never looks like "not saved".
 */
async function readSaved(
  envVar: string,
  scope: "user" | "org" | undefined,
): Promise<string | null> {
  if (scope === "user" || scope === "org") {
    const scopeId =
      scope === "user" ? getRequestUserEmail() : getRequestOrgId();
    if (!scopeId) return null;
    const row = await readAppSecret({ key: envVar, scope, scopeId });
    return row?.value || null;
  }
  const resolved = await resolveSecretDetailed(envVar);
  if (resolved.value && resolved.source && resolved.source !== "env") {
    return resolved.value;
  }
  if (resolved.lookupFailed) {
    throw new Error("Could not read the credential store.");
  }
  return null;
}

/** The endpoint a check targets before validation; null is the default. */
async function requestedEndpoint(
  provider: "openai" | "ollama",
  input: ProviderKeyCheckInput,
): Promise<string | null> {
  if (typeof input.baseUrl === "string" && input.baseUrl.trim()) {
    return input.baseUrl.trim();
  }
  if (input.baseUrl !== undefined) return null;
  return readSaved(
    provider === "ollama" ? OLLAMA_BASE_URL_ENV_VAR : OPENAI_BASE_URL_ENV_VAR,
    input.scope,
  );
}

/**
 * The OpenAI endpoint chats resolve, deployment value included, before
 * validation. Auth-failure markers are global per key value, so a check only
 * writes one when it reached this same endpoint.
 */
async function runtimeOpenAiEndpoint(): Promise<string | null> {
  const resolved = await resolveSecretDetailed(OPENAI_BASE_URL_ENV_VAR);
  if (resolved.value) return resolved.value;
  if (resolved.lookupFailed) {
    throw new Error("Could not read the credential store.");
  }
  return null;
}

async function assertMayCheck(input: ProviderKeyCheckInput): Promise<void> {
  if (
    input.provider !== "ollama" &&
    !input.key?.trim() &&
    input.baseUrl !== undefined
  ) {
    throw new ProviderKeyCheckRequestError(
      "Pass a key with baseUrl. A saved key is only checked against its saved endpoint.",
      400,
    );
  }
  if (input.scope !== "org") return;
  const orgId = getRequestOrgId();
  if (!orgId) return;
  const email = getRequestUserEmail();
  if (!email || !canManageOrg(await getOrgRoleForEmail(orgId, email))) {
    throw new ProviderKeyCheckRequestError(
      "Only organization owners and admins can check organization keys.",
      403,
    );
  }
}

async function validateEndpoint(
  provider: "openai" | "ollama",
  requested: string | null,
): Promise<string | null> {
  if (provider === "ollama") {
    return validateProviderBaseUrl(requested ?? DEFAULT_OLLAMA_BASE_URL, {
      allowLocalOllama: isTrustedSelfHostedRuntime(),
      isOllama: true,
    });
  }
  if (!requested) return null;
  const validated = await validateProviderBaseUrl(requested);
  return isCustomOpenAiBaseUrl(validated) ? validated : null;
}

/**
 * Ask the provider which models a key reaches. The same answer validates the
 * key and fills the model checklist. Reads saved keys and endpoints through
 * the ambient request context, so callers outside an action run it inside
 * `runWithRequestContext`. Never logs or returns the key.
 */
export async function checkProviderKey(
  input: ProviderKeyCheckInput,
): Promise<ProviderKeyCheckResult> {
  const { provider } = input;
  await assertMayCheck(input);

  let requested: string | null = null;
  let endpoint: string | null = null;
  if (provider === "openai" || provider === "ollama") {
    requested = await requestedEndpoint(provider, input);
    try {
      endpoint = await validateEndpoint(provider, requested);
    } catch (err) {
      return failure(
        provider,
        "invalid-endpoint",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  if (provider === "ollama") {
    return listOllamaModels(endpoint!, isTrustedSelfHostedRuntime());
  }

  const envVar = PROVIDER_ENV_META[provider]?.envVar;
  if (!envVar) {
    throw new Error(`No API key is defined for provider "${provider}".`);
  }
  const pasted = input.key?.trim() ?? "";
  const key = pasted || (await readSaved(envVar, input.scope)) || "";
  if (!key) {
    return failure(
      provider,
      "missing-key",
      `No ${providerLabel(provider)} key is saved.`,
    );
  }

  const gateway = provider === "openai" && !!endpoint;
  const detected = gateway ? null : detectKeyProvider(key);
  if (detected && detected !== provider) {
    return failure(
      provider,
      "wrong-provider",
      `This looks like ${withArticle(providerLabel(detected))} key.`,
      { detectedProvider: detected },
    );
  }

  const result =
    provider === "openrouter"
      ? await listOpenRouterModels(key)
      : await listModels(provider, key, listingFor(provider, key, endpoint));

  // A key that works has nothing to be skipped for. Only a saved key's
  // rejection is recorded, so arbitrary pasted values never create markers.
  if (!result.ok && (pasted || result.code !== "rejected")) return result;
  if (
    provider === "openai" &&
    (input.baseUrl !== undefined ||
      requested !== (await runtimeOpenAiEndpoint()))
  ) {
    return result;
  }
  if (result.ok) {
    await clearProviderCredentialAuthFailure({ key: envVar, value: key });
  } else {
    await recordProviderCredentialAuthFailure({
      key: envVar,
      value: key,
      status: result.status,
      message: result.reason,
    });
  }
  return result;
}

/**
 * The key-save gate: the same check, folded into the save route's error
 * shape. Rejections are 400s; an unreachable provider is a 502 so the key is
 * not stored unverified.
 */
export async function checkProviderKeyForSave(
  input: ProviderKeyCheckInput & { key: string },
): Promise<
  | { ok: true; models: string[] }
  | { ok: false; statusCode: number; error: string; code: ProviderKeyCheckCode }
> {
  const result = await checkProviderKey(input);
  if (result.ok) return { ok: true, models: result.models };
  const headline = providerKeyRejectedHeadline(input.provider);
  const keyProblem =
    result.code === "rejected" || result.code === "wrong-provider";
  return {
    ok: false,
    statusCode: keyProblem || result.code === "invalid-endpoint" ? 400 : 502,
    error:
      keyProblem && result.reason !== headline
        ? `${headline} ${result.reason}`
        : result.reason,
    code: result.code,
  };
}
