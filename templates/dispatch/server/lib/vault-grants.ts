import { getDbExec } from "@agent-native/core/db";
import { getOrgSetting } from "@agent-native/core/settings";
import { credentialKeyAliases } from "@agent-native/core/workspace-connections";

const VAULT_ACCESS_SETTINGS_KEY = "dispatch-vault-access-settings";

export interface VaultCredentialRef {
  key: string;
  scope?: string | undefined;
  provider?: string | undefined;
}

/**
 * Vault keys the refs point at that the vault has not granted to `appId`.
 * Empty unless the org's vault is in manual mode. Lookup failures throw: an
 * unreadable vault must not read as "everything is granted".
 */
export async function findUngrantedVaultKeys(
  orgId: string,
  appId: string,
  refs: VaultCredentialRef[],
): Promise<string[]> {
  const keys = Array.from(
    new Set(
      refs
        .filter((ref) => ref.scope !== "user")
        .flatMap((ref) =>
          credentialKeyAliases(ref.provider ?? "", ref.key.trim()),
        )
        .filter(Boolean)
        .map((key) => key.toUpperCase()),
    ),
  );
  if (keys.length === 0) return [];

  const settings = await getOrgSetting(orgId, VAULT_ACCESS_SETTINGS_KEY);
  if (settings?.mode !== "manual") return [];

  // raw-sql-ok: interpolates only a fixed list of ? placeholders; all values are bound
  const { rows } = await getDbExec().execute({
    sql: `SELECT secrets.credential_key AS credential_key,
        MAX(CASE WHEN grants.id IS NULL THEN 0 ELSE 1 END) AS granted
      FROM vault_secrets AS secrets
      LEFT JOIN vault_grants AS grants
        ON grants.secret_id = secrets.id
        AND grants.org_id = secrets.org_id
        AND grants.app_id = ?
        AND grants.status = 'active'
      WHERE secrets.org_id = ?
        AND UPPER(secrets.credential_key) IN (${keys.map(() => "?").join(", ")})
      GROUP BY secrets.credential_key`,
    args: [appId, orgId, ...keys],
  });
  return rows
    .filter((row) => Number(row.granted) !== 1)
    .map((row) => String(row.credential_key));
}
