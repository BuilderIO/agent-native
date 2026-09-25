import { agentNativePath } from "../api-path.js";

const ADHOC_ENDPOINT = agentNativePath("/_agent-native/secrets/adhoc");

/**
 * Names of ad-hoc keys stored at personal or workspace scope. Org rows are
 * written by the Vault or Builder Connect and are never removed from here.
 * Throws when the list cannot be read, so callers can tell "none" apart.
 */
export async function listRemovableSecretNames(): Promise<Set<string>> {
  const res = await fetch(ADHOC_ENDPOINT);
  if (!res.ok) throw new Error(`Failed to load keys (${res.status})`);
  const rows = (await res.json()) as Array<{ name: string; scope: string }>;
  return new Set(
    rows.filter((row) => row.scope !== "org").map((row) => row.name),
  );
}

export interface ManagedSecretRemoval {
  removed: string[];
  /** Keys the server kept, e.g. a shared row a member may not remove. */
  kept: string[];
}

/**
 * Removes keys from the Settings surface that owns them. The secrets routes
 * refuse a managed key unless the owner names itself, so `managerId` must be
 * the owner's id from `SECRET_MANAGERS`. Throws the server's message on the
 * first failed request.
 */
export async function removeManagedSecrets(
  keys: readonly string[],
  managerId: string,
): Promise<ManagedSecretRemoval> {
  const result: ManagedSecretRemoval = { removed: [], kept: [] };
  for (const key of keys) {
    const res = await fetch(
      `${ADHOC_ENDPOINT}/${encodeURIComponent(key)}?managedBy=${encodeURIComponent(managerId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const error = await res
        .json()
        .then((j: { error?: unknown }) => j?.error)
        // coercion-ok: the error body is optional; the throw below reports the failure either way.
        .catch(() => undefined);
      throw new Error(
        typeof error === "string"
          ? error
          : `Could not remove ${key} (${res.status})`,
      );
    }
    const body = (await res.json()) as { removed?: boolean };
    (body?.removed ? result.removed : result.kept).push(key);
  }
  return result;
}
