/**
 * Marker on `app_secrets.description` that releases before the Vault moved
 * onto `app_secrets` wrote on every Vault-owned row. New Vault writes mark a
 * row with `created_by` instead, so a release that still deletes rows carrying
 * this prefix when `vault_secrets` has no matching row never sees them.
 */
export const VAULT_SYNC_DESCRIPTION_PREFIX = "Synced from Dispatch vault:";

/**
 * True for a key the Dispatch Vault owns: created or edited through the Vault
 * (`created_by` is set), or written by a release that marked it in the
 * description. Rows an app registered for itself, and a person's own keys, are
 * neither. Callers rule out `user` scope themselves.
 */
export function isVaultManagedSecret(
  meta:
    | {
        description?: string | null | undefined;
        createdBy?: string | null | undefined;
      }
    | null
    | undefined,
): boolean {
  if (!meta) return false;
  return (
    !!meta.createdBy ||
    !!meta.description?.startsWith(VAULT_SYNC_DESCRIPTION_PREFIX)
  );
}
