import { MAX_AWARENESS_CLIENT_SEQUENCE } from "./awareness-sequence.js";

const AWARENESS_POST_TIMEOUT_MS = 5_000;

const clientSequences = new Map<string, number>();
const clearTokens = new Map<string, string>();
const inFlightPosts = new Map<string, number>();
const cleanupWhenIdle = new Set<string>();

function sequenceKey(baseUrl: string, docId: string, clientId: number): string {
  return JSON.stringify([baseUrl, docId, clientId]);
}

function nextClientSequence(key: string): number {
  const sequence = (clientSequences.get(key) ?? 0) + 1;
  if (sequence > MAX_AWARENESS_CLIENT_SEQUENCE) {
    throw new Error("awareness client sequence exceeded the supported range");
  }
  clientSequences.set(key, sequence);
  return sequence;
}

function clearTokenFor(key: string): string {
  const existing = clearTokens.get(key);
  if (existing) return existing;
  const bytes = new Uint8Array(32);
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure awareness clear tokens are unavailable");
  }
  globalThis.crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  clearTokens.set(key, token);
  return token;
}

function finishPost(key: string): void {
  const remaining = (inFlightPosts.get(key) ?? 1) - 1;
  if (remaining > 0) {
    inFlightPosts.set(key, remaining);
    return;
  }
  inFlightPosts.delete(key);
  if (cleanupWhenIdle.delete(key)) {
    clientSequences.delete(key);
    clearTokens.delete(key);
  }
}

export function forgetAwarenessClientSequence(
  baseUrl: string,
  docId: string,
  clientId: number,
): void {
  const key = sequenceKey(baseUrl, docId, clientId);
  if (inFlightPosts.has(key)) {
    cleanupWhenIdle.add(key);
    return;
  }
  clientSequences.delete(key);
  clearTokens.delete(key);
}

export function postAwarenessState(
  baseUrl: string,
  docId: string,
  clientId: number,
  state: Record<string, unknown> | null,
  keepalive = false,
): Promise<Response> {
  const key = sequenceKey(baseUrl, docId, clientId);
  const clientSequence = nextClientSequence(key);
  const clearToken = clearTokenFor(key);
  inFlightPosts.set(key, (inFlightPosts.get(key) ?? 0) + 1);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AWARENESS_POST_TIMEOUT_MS,
  );

  return fetch(`${baseUrl}/${docId}/awareness`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId,
      clientSequence,
      clearToken,
      state: state ? JSON.stringify(state) : null,
    }),
    signal: controller.signal,
    ...(keepalive ? { keepalive: true } : {}),
  })
    .then(async (response) => {
      await response.clone().arrayBuffer();
      const expectedSequence = response.headers.get(
        "x-awareness-client-sequence",
      );
      if (response.status === 409 && expectedSequence !== null) {
        const parsedSequence = Number(expectedSequence);
        if (
          Number.isSafeInteger(parsedSequence) &&
          parsedSequence >= 0 &&
          parsedSequence <= MAX_AWARENESS_CLIENT_SEQUENCE
        ) {
          if (!cleanupWhenIdle.has(key)) {
            clientSequences.set(
              key,
              Math.max(clientSequences.get(key) ?? 0, parsedSequence),
            );
          }
        }
      }
      return response;
    })
    .finally(() => {
      clearTimeout(timeout);
      finishPost(key);
    });
}
