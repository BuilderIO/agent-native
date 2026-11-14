import { resolveSecretDetailed } from "../server/credential-provider.js";
import type { ReasoningEffort } from "../shared/reasoning-effort.js";

/** What the provider's own model list says about one model. */
export interface ProviderModelMetadata {
  id: string;
  /** `max_input_tokens`. */
  contextWindow?: number;
  /** `max_tokens`. */
  maxOutputTokens?: number;
  /**
   * Levels under `capabilities.effort` whose `supported` is true. Undefined
   * when the provider does not report effort for the model, which is not the
   * same as reporting that it supports none.
   */
  efforts?: ReasoningEffort[];
  /** Keys under `capabilities.thinking.types` whose `supported` is true. */
  thinkingTypes?: string[];
}

export type ProviderModelMetadataUnavailableReason =
  | "missing-key"
  | "credential-unreadable"
  | "rejected"
  | "unreachable"
  | "provider-error";

export type ProviderModelMetadataResult =
  | {
      state: "available";
      fetchedAt: number;
      models: Readonly<Record<string, ProviderModelMetadata>>;
    }
  | {
      state: "unavailable";
      reason: ProviderModelMetadataUnavailableReason;
      status?: number;
    };

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
const ANTHROPIC_KEY = "ANTHROPIC_API_KEY";
const AVAILABLE_TTL_MS = 60 * 60 * 1000;
// A failure is retried sooner, but not on every picker open.
const UNAVAILABLE_TTL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_PAGES = 5;
const EFFORT_LEVELS: readonly ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

interface CacheEntry {
  expiresAt: number;
  result: Promise<ProviderModelMetadataResult>;
}

// Filled on first use, never at module load.
const cache = new Map<string, CacheEntry>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function supportedKeys(value: unknown): string[] | undefined {
  if (!isRecord(value)) return undefined;
  return Object.keys(value).filter((key) => {
    const leaf = value[key];
    return isRecord(leaf) && leaf["supported"] === true;
  });
}

/** One `data[]` entry of `GET /v1/models`; exported for specs. */
export function parseAnthropicModelEntry(
  entry: unknown,
): ProviderModelMetadata | null {
  if (!isRecord(entry) || typeof entry["id"] !== "string") return null;
  const capabilities = isRecord(entry["capabilities"])
    ? entry["capabilities"]
    : undefined;
  const effortKeys = supportedKeys(capabilities?.["effort"]);
  const thinking = isRecord(capabilities?.["thinking"])
    ? capabilities["thinking"]
    : undefined;
  const thinkingTypes = supportedKeys(thinking?.["types"]);
  const contextWindow = positiveInt(entry["max_input_tokens"]);
  const maxOutputTokens = positiveInt(entry["max_tokens"]);
  return {
    id: entry["id"],
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    ...(effortKeys
      ? {
          efforts: EFFORT_LEVELS.filter((level) => effortKeys.includes(level)),
        }
      : {}),
    ...(thinkingTypes ? { thinkingTypes } : {}),
  };
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes).slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchAnthropicModels(
  key: string,
  fetchImpl: typeof fetch,
): Promise<ProviderModelMetadataResult> {
  const models: Record<string, ProviderModelMetadata> = {};
  let url = `${ANTHROPIC_MODELS_URL}?limit=1000`;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { state: "unavailable", reason: "unreachable" };
    }
    if (!response.ok) {
      return {
        state: "unavailable",
        reason:
          response.status === 401 || response.status === 403
            ? "rejected"
            : "provider-error",
        status: response.status,
      };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { state: "unavailable", reason: "provider-error" };
    }
    if (!isRecord(body) || !Array.isArray(body["data"])) {
      return { state: "unavailable", reason: "provider-error" };
    }
    for (const entry of body["data"]) {
      const parsed = parseAnthropicModelEntry(entry);
      if (parsed) models[parsed.id] = parsed;
    }
    const lastId = body["last_id"];
    if (body["has_more"] !== true || typeof lastId !== "string") break;
    url = `${ANTHROPIC_MODELS_URL}?limit=1000&after_id=${encodeURIComponent(lastId)}`;
  }
  return { state: "available", fetchedAt: Date.now(), models };
}

/**
 * The Anthropic model list for the key this request's chats use, cached per
 * credential for an hour. Never throws: an unreadable store, a missing key,
 * or a failed request is a typed `unavailable` result the caller reports
 * instead of filling in catalog values as if the provider had said them.
 */
export async function readAnthropicModelMetadata(
  options: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<ProviderModelMetadataResult> {
  const now = options.now ?? Date.now;
  const resolved = await resolveSecretDetailed(ANTHROPIC_KEY);
  if (!resolved.value) {
    return {
      state: "unavailable",
      reason: resolved.lookupFailed ? "credential-unreadable" : "missing-key",
    };
  }
  const cacheKey = `${resolved.source ?? "unknown"}:${resolved.scopeId ?? ""}:${await digest(resolved.value)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now()) return cached.result;
  const result = fetchAnthropicModels(
    resolved.value,
    options.fetchImpl ?? fetch,
  );
  const entry: CacheEntry = { expiresAt: now() + AVAILABLE_TTL_MS, result };
  cache.set(cacheKey, entry);
  void result.then((settled) => {
    if (settled.state === "unavailable" && cache.get(cacheKey) === entry) {
      entry.expiresAt = now() + UNAVAILABLE_TTL_MS;
    }
  });
  return result;
}

/** Engines whose picker rows can read live provider metadata. */
export const LIVE_METADATA_ENGINES: ReadonlySet<string> = new Set([
  "anthropic",
  "ai-sdk:anthropic",
]);

export function __resetProviderModelMetadataCache(): void {
  cache.clear();
}
