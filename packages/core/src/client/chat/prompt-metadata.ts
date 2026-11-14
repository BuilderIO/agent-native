import { getOrCreateAnalyticsSessionId } from "../analytics-session.js";

const PROMPT_HASH_KEY_STORAGE_KEY = "agent-native.prompt_hash_key";
const PROMPT_HASH_DOMAIN = "agent-native.prompt-metadata.v1\0";

export type PromptCategory =
  | "create"
  | "edit"
  | "summarize"
  | "analyze"
  | "question"
  | "other";

export interface SafePromptMetadata {
  prompt_category: PromptCategory;
  prompt_length_bucket: string;
  prompt_hash?: string;
}

interface StoredPromptHashKey {
  sessionId: string;
  key: string;
}

function promptLengthBucket(length: number): string {
  if (length === 0) return "0";
  if (length <= 50) return "1-50";
  if (length <= 120) return "51-120";
  if (length <= 250) return "121-250";
  if (length <= 500) return "251-500";
  if (length <= 1000) return "501-1000";
  return "1001+";
}

function promptCategory(prompt: string): PromptCategory {
  const normalized = prompt.trim().toLocaleLowerCase();
  if (!normalized) return "other";
  if (
    /^(?:what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|will|has|have)\b|[?？]\s*$/.test(
      normalized,
    )
  ) {
    return "question";
  }
  if (/^(?:summari[sz]e|recap|tl;dr)\b/.test(normalized)) return "summarize";
  if (
    /^(?:create|build|make|design|generate|draft|write|produce)\b/.test(
      normalized,
    )
  ) {
    return "create";
  }
  if (
    /^(?:edit|revise|improve|update|change|fix|remove|add|replace|rewrite|shorten|expand)\b/.test(
      normalized,
    )
  ) {
    return "edit";
  }
  if (
    /^(?:analy[sz]e|compare|review|inspect|find|search|list|extract|classify|categorize|explain)\b/.test(
      normalized,
    )
  ) {
    return "analyze";
  }
  return "other";
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string): Uint8Array | undefined {
  if (!/^[a-f0-9]{64}$/i.test(value)) return undefined;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function sessionScopedHashKey(sessionId: string): Uint8Array | undefined {
  try {
    const storage = Reflect.get(globalThis, "sessionStorage") as
      | Storage
      | undefined;
    const cryptoApi = Reflect.get(globalThis, "crypto") as Crypto | undefined;
    if (!storage || !cryptoApi?.getRandomValues) return undefined;

    let stored: StoredPromptHashKey | undefined;
    try {
      const raw = storage.getItem(PROMPT_HASH_KEY_STORAGE_KEY);
      if (raw) stored = JSON.parse(raw) as StoredPromptHashKey;
    } catch {
      // coercion-ok: blocked or malformed storage has no reusable key.
      // A blocked or malformed storage entry has no reusable key.
    }

    if (stored?.sessionId === sessionId && typeof stored.key === "string") {
      const existingKey = hexToBytes(stored.key);
      if (existingKey) return existingKey;
    }

    const key = cryptoApi.getRandomValues(new Uint8Array(32));
    storage.setItem(
      PROMPT_HASH_KEY_STORAGE_KEY,
      JSON.stringify({
        sessionId,
        key: bytesToHex(key),
      } satisfies StoredPromptHashKey),
    );
    return key;
  } catch {
    // coercion-ok: hash metadata is optional when storage is blocked.
    return undefined;
  }
}

/**
 * Derives coarse prompt metadata without returning or persisting the prompt.
 * The HMAC key stays in tab-local sessionStorage and rotates with the analytics
 * session, so prompt hashes cannot be joined across browser sessions.
 */
export function summarizePrompt(
  prompt: string,
): Omit<SafePromptMetadata, "prompt_hash"> {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  return {
    prompt_category: promptCategory(normalized),
    prompt_length_bucket: promptLengthBucket(normalized.length),
  };
}

export async function buildSafePromptHash(
  prompt: string,
): Promise<string | undefined> {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  if (!normalized) return undefined;

  try {
    const sessionId = getOrCreateAnalyticsSessionId();
    const keyBytes = sessionId ? sessionScopedHashKey(sessionId) : undefined;
    const cryptoApi = Reflect.get(globalThis, "crypto") as Crypto | undefined;
    if (!keyBytes || !cryptoApi?.subtle) return undefined;

    const keyBuffer = new ArrayBuffer(keyBytes.byteLength);
    new Uint8Array(keyBuffer).set(keyBytes);
    const key = await cryptoApi.subtle.importKey(
      "raw",
      keyBuffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await cryptoApi.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${PROMPT_HASH_DOMAIN}${normalized}`),
    );
    return bytesToHex(new Uint8Array(digest));
  } catch {
    // coercion-ok: crypto failure omits only the optional prompt hash.
    // Metadata is optional; an unavailable crypto or storage API adds no hash.
    return undefined;
  }
}

export async function buildSafePromptMetadata(
  prompt: string,
): Promise<SafePromptMetadata> {
  const summary = summarizePrompt(prompt);
  const promptHash = await buildSafePromptHash(prompt);
  return promptHash ? { ...summary, prompt_hash: promptHash } : summary;
}
