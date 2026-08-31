import { getDbExec, intType, isPostgres } from "../db/client.js";
import { ensureTableExists } from "../db/ddl-guard.js";
import type { JobFrontmatter } from "../jobs/frontmatter.js";
import type { Resource } from "../resources/store.js";
import {
  deleteAppSecret,
  readAppSecret,
  writeAppSecret,
  type SecretRef,
} from "../secrets/storage.js";
import {
  automationWebhookPath,
  automationWebhookTokenHash,
  isAutomationWebhookToken,
  webhookTokensMatch,
} from "./webhook.js";

const WEBHOOK_SECRET_KEY_PREFIX = "automation-webhook:";

let _initPromise: Promise<void> | undefined;

function secretRef(
  resource: Pick<Resource, "id" | "owner">,
  meta: Pick<JobFrontmatter, "createdBy" | "orgId">,
): SecretRef {
  const orgId = meta.orgId?.trim();
  if (orgId) {
    return {
      key: `${WEBHOOK_SECRET_KEY_PREFIX}${resource.id}`,
      scope: "org",
      scopeId: orgId,
    };
  }
  return {
    key: `${WEBHOOK_SECRET_KEY_PREFIX}${resource.id}`,
    scope: "user",
    scopeId: (meta.createdBy?.trim() || resource.owner).toLowerCase(),
  };
}

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const client = getDbExec();
      const createSql = `CREATE TABLE IF NOT EXISTS automation_webhook_tokens (
  token_hash TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  path TEXT NOT NULL,
  secret_scope TEXT NOT NULL,
  secret_scope_id TEXT NOT NULL,
  secret_key TEXT NOT NULL,
  created_at ${intType()} NOT NULL,
  updated_at ${intType()} NOT NULL
)`;

      if (isPostgres()) {
        await ensureTableExists("automation_webhook_tokens", createSql);
        return;
      }
      await client.execute(createSql);
    })().catch((error) => {
      _initPromise = undefined;
      throw error;
    });
  }
  return _initPromise;
}

export async function saveAutomationWebhookToken(
  resource: Pick<Resource, "id" | "owner" | "path">,
  meta: Pick<JobFrontmatter, "createdBy" | "orgId">,
  token: string,
): Promise<void> {
  if (!isAutomationWebhookToken(token)) {
    throw new Error("Invalid automation webhook token.");
  }
  await ensureTable();
  const ref = secretRef(resource, meta);
  await writeAppSecret({ ...ref, value: token });
  try {
    await getDbExec().execute({
      sql: `INSERT INTO automation_webhook_tokens
        (token_hash, automation_id, owner, path, secret_scope, secret_scope_id, secret_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (automation_id) DO UPDATE SET
          token_hash = excluded.token_hash,
          owner = excluded.owner,
          path = excluded.path,
          secret_scope = excluded.secret_scope,
          secret_scope_id = excluded.secret_scope_id,
          secret_key = excluded.secret_key,
          updated_at = excluded.updated_at`,
      args: [
        automationWebhookTokenHash(token),
        resource.id,
        resource.owner,
        resource.path,
        ref.scope,
        ref.scopeId,
        ref.key,
        Date.now(),
        Date.now(),
      ],
    });
  } catch (error) {
    await deleteAppSecret(ref).catch(() => undefined);
    throw error;
  }
}

export async function deleteAutomationWebhookToken(
  resource: Pick<Resource, "id" | "owner">,
  meta: Pick<JobFrontmatter, "createdBy" | "orgId">,
): Promise<void> {
  await ensureTable();
  const ref = secretRef(resource, meta);
  await getDbExec().execute({
    sql: "DELETE FROM automation_webhook_tokens WHERE automation_id = ?",
    args: [resource.id],
  });
  await deleteAppSecret(ref);
}

export async function readAutomationWebhookPath(
  resource: Pick<Resource, "id" | "owner">,
  meta: Pick<JobFrontmatter, "createdBy" | "orgId">,
): Promise<string | undefined> {
  const stored = await readAppSecret(secretRef(resource, meta));
  if (!stored || !isAutomationWebhookToken(stored.value)) return undefined;
  return automationWebhookPath(stored.value);
}

export interface AutomationWebhookTarget {
  automationId: string;
  owner: string;
  path: string;
}

export async function findAutomationWebhookTarget(
  token: string,
): Promise<AutomationWebhookTarget | null> {
  if (!isAutomationWebhookToken(token)) return null;
  await ensureTable();
  const { rows } = await getDbExec().execute({
    sql: `SELECT automation_id, owner, path, secret_scope, secret_scope_id, secret_key
      FROM automation_webhook_tokens WHERE token_hash = ? LIMIT 1`,
    args: [automationWebhookTokenHash(token)],
  });
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const stored = await readAppSecret({
    key: String(row.secret_key),
    scope: String(row.secret_scope) as SecretRef["scope"],
    scopeId: String(row.secret_scope_id),
  });
  if (!stored || !webhookTokensMatch(stored.value, token)) return null;
  return {
    automationId: String(row.automation_id),
    owner: String(row.owner),
    path: String(row.path),
  };
}
