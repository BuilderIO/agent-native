/**
 * Thin client for calling scheduling actions via the framework HTTP endpoint
 * (`/_agent-native/actions/:name`). Uses @tanstack/react-query.
 */
import { agentNativePath } from "@agent-native/core/client";

export async function callAction<T = any>(
  name: string,
  args?: Record<string, any>,
  init?: { signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(agentNativePath(`/_agent-native/actions/${name}`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args ?? {}),
    signal: init?.signal,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Action ${name} failed: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}

/**
 * Browser-safe application_state helpers. The core script-helpers module is
 * Node-only (it imports EventEmitter), so we use the framework's HTTP endpoint
 * directly in the browser.
 */
export async function writeAppState(
  key: string,
  value: unknown,
): Promise<void> {
  try {
    await fetch(
      agentNativePath(
        `/_agent-native/application-state/${encodeURIComponent(key)}`,
      ),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
      },
    );
  } catch {
    // Swallow — application state is best-effort in the UI.
  }
}

export async function readAppState<T = unknown>(
  key: string,
): Promise<T | null> {
  try {
    const res = await fetch(
      agentNativePath(
        `/_agent-native/application-state/${encodeURIComponent(key)}`,
      ),
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { value?: T };
    return body?.value ?? null;
  } catch {
    return null;
  }
}

export async function deleteAppState(key: string): Promise<void> {
  try {
    await fetch(
      agentNativePath(
        `/_agent-native/application-state/${encodeURIComponent(key)}`,
      ),
      {
        method: "DELETE",
      },
    );
  } catch {
    // best-effort
  }
}
