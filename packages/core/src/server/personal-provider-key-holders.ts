/**
 * Who loses what when an organization restricts personal API keys: each
 * member (owners and admins keep theirs) with the provider keys and the
 * personal Builder.io connection they have stored. Presence only; no value is
 * decrypted or returned.
 */

import { AGENT_PROVIDER_CATALOG } from "../client/agent-provider-catalog.js";
import { getDbExec } from "../db/client.js";
import { ensureTable as ensureAppSecretsTable } from "../secrets/storage.js";
import { BUILDER_CREDENTIAL_KEYS } from "./builder-credential-keys.js";
import { hasStoredBuilderOAuthGrant } from "./builder-oauth.js";
import { listPersonalProviderPolicyKeys } from "./personal-provider-key-policy.js";

export interface PersonalProviderKeyHolderProvider {
  /** Provider id, e.g. "anthropic", or the key name for a provider outside the catalog. */
  provider: string;
  /** Display name, e.g. "Anthropic". */
  label: string;
  /** Stored key names for this provider, e.g. ["OPENAI_API_KEY", "OPENAI_BASE_URL"]. */
  keys: string[];
}

export interface PersonalProviderKeyHolder {
  email: string;
  providers: PersonalProviderKeyHolderProvider[];
  /** A personal Builder.io connection (OAuth grant or key pair) is stored. */
  builder: boolean;
}

const EXTRA_PROVIDERS: Record<string, { provider: string; label: string }> = {
  GEMINI_API_KEY: { provider: "google", label: "Google Gemini" },
  VOYAGE_API_KEY: { provider: "voyage", label: "Voyage AI" },
};

function providerForKey(key: string): { provider: string; label: string } {
  const option = AGENT_PROVIDER_CATALOG.find(
    (item) => item.key === key || item.endpointKey === key,
  );
  if (option) return { provider: option.id, label: option.label };
  return EXTRA_PROVIDERS[key] ?? { provider: key, label: key };
}

const BUILDER_KEYS: ReadonlySet<string> = new Set(BUILDER_CREDENTIAL_KEYS);

/**
 * Members of `orgId` whose personal provider keys or personal Builder.io
 * connection stop while the restriction is on, sorted by email. Members with
 * nothing stored are left out. Throws when a store cannot be read.
 */
export async function listPersonalProviderKeyHolders(
  orgId: string,
): Promise<PersonalProviderKeyHolder[]> {
  const db = getDbExec();
  const { rows: memberRows } = await db.execute({
    sql: `SELECT email, role FROM org_members
          WHERE org_id = ? AND federation_removal_pending_at IS NULL`,
    args: [orgId],
  });
  const members = [
    ...new Set(
      memberRows
        .filter((row) => row.role !== "owner" && row.role !== "admin")
        .map((row) =>
          String(row.email ?? "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  ];
  if (members.length === 0) return [];

  await ensureAppSecretsTable();
  // The personal Builder key pair counts once, by its private key.
  const keys = listPersonalProviderPolicyKeys().filter(
    (key) => !BUILDER_KEYS.has(key) || key === "BUILDER_PRIVATE_KEY",
  );
  const soloIds = members.map((email) => `solo:${email}`);
  const marks = (values: readonly unknown[]) =>
    values.map(() => "?").join(", ");
  const { rows: secretRows } = await db.execute({
    sql: `SELECT scope, scope_id, key FROM app_secrets
          WHERE key IN (${marks(keys)})
            AND ((scope = 'user' AND LOWER(scope_id) IN (${marks(members)}))
              OR (scope = 'workspace' AND LOWER(scope_id) IN (${marks(soloIds)})))`,
    args: [...keys, ...members, ...soloIds],
  });

  const stored = new Map<string, Set<string>>();
  for (const row of secretRows) {
    const scopeId = String(row.scope_id ?? "").toLowerCase();
    const email = scopeId.startsWith("solo:") ? scopeId.slice(5) : scopeId;
    const set = stored.get(email) ?? new Set<string>();
    set.add(String(row.key));
    stored.set(email, set);
  }

  const oauthGrants = await Promise.all(
    members.map((email) => hasStoredBuilderOAuthGrant(email, "user")),
  );

  const holders: PersonalProviderKeyHolder[] = [];
  members.forEach((email, index) => {
    const memberKeys = stored.get(email) ?? new Set<string>();
    const byProvider = new Map<string, PersonalProviderKeyHolderProvider>();
    for (const key of [...memberKeys].sort()) {
      if (BUILDER_KEYS.has(key)) continue;
      const { provider, label } = providerForKey(key);
      const entry = byProvider.get(provider) ?? { provider, label, keys: [] };
      entry.keys.push(key);
      byProvider.set(provider, entry);
    }
    const builder =
      oauthGrants[index] === true || memberKeys.has("BUILDER_PRIVATE_KEY");
    if (byProvider.size === 0 && !builder) return;
    holders.push({ email, providers: [...byProvider.values()], builder });
  });
  return holders.sort((a, b) => a.email.localeCompare(b.email));
}
