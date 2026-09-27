import { agentNativePath } from "../../api-path.js";

const SECRETS_ENDPOINT = agentNativePath("/_agent-native/secrets");

export interface SaveApiKeyValueInput {
  name: string;
  value: string;
  /** Registered keys save at their registered scope and run its validator. */
  registered: boolean;
  /** Ad-hoc keys only: save for everyone in the organization. */
  shared?: boolean;
}

async function readError(res: Response): Promise<string | null> {
  const body = await res
    .json()
    .then((json: { error?: unknown }) => json?.error)
    // coercion-ok: the error body is optional; callers still throw on !res.ok.
    .catch(() => undefined);
  return typeof body === "string" && body ? body : null;
}

function notifyKeysChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agent-engine:configured-changed", {
      detail: { source: "secrets" },
    }),
  );
}

/**
 * Save a key's value from Settings › API keys. Values go to the secrets
 * routes, never through an action, so they stay out of agent tool history.
 * Throws the server's message when the save is refused.
 */
export async function saveApiKeyValue({
  name,
  value,
  registered,
  shared,
}: SaveApiKeyValueInput): Promise<void> {
  const res = registered
    ? await fetch(`${SECRETS_ENDPOINT}/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      })
    : await fetch(`${SECRETS_ENDPOINT}/adhoc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          value,
          scope: shared ? "workspace" : "user",
        }),
      });
  if (!res.ok) {
    throw new Error(
      (await readError(res)) ?? `Could not save ${name} (${res.status})`,
    );
  }
  notifyKeysChanged();
}

export type SavedApiKeyTest = { ok: true } | { ok: false; error: string };

/** Run a registered key's validator against its saved value. */
export async function testSavedApiKey(name: string): Promise<SavedApiKeyTest> {
  const res = await fetch(
    `${SECRETS_ENDPOINT}/${encodeURIComponent(name)}/test`,
    { method: "POST" },
  );
  const body = (await res
    .json()
    // coercion-ok: a missing body reads as a failed test below, never a pass.
    .catch(() => ({}))) as { ok?: boolean; error?: string };
  if (res.ok && body.ok === true) return { ok: true };
  return {
    ok: false,
    error: body.error ?? `Could not test ${name} (${res.status})`,
  };
}

export { notifyKeysChanged };
