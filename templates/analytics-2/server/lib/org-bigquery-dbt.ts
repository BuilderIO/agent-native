import { fail } from "@agent-native/core/action";
import { getDbExec, type DbExec } from "@agent-native/core/db";
import {
  readAppSecret,
  readAppSecretMeta,
  writeAppSecret,
} from "@agent-native/core/secrets";
import {
  getCredentialContext,
  getRequestContext,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { getOrgSetting, mutateOrgSetting } from "@agent-native/core/settings";
import type { StoreWriteOptions } from "@agent-native/core/settings";
import { z } from "zod";

import { getDb } from "../db/index.js";

/**
 * The single vault slot that holds the user-supplied dbt Service token. It is
 * registered as an optional, organization-scoped API key by
 * `server/plugins/dbt-credentials.ts`, so Settings can write it too. Nothing in
 * this module ever reads a user, environment or other-organization fallback.
 */
export const DBT_SERVICE_TOKEN_KEY = "ANALYTICS_WAREHOUSE_DBT_SERVICE_TOKEN";

/**
 * The nonsecret half of the dbt connection: the provider configuration and the
 * revision that an optimizer can compare. The token never lives here.
 */
export const ORGANIZATION_BIGQUERY_DBT_SETTING_KEY =
  "analytics-2.organization-bigquery-dbt";

const MAX_ID_LENGTH = 64;
const MAX_HOSTNAME_LENGTH = 255;

/**
 * The persisted shape of a dbt configuration. It is deliberately strict: a
 * stored config that carries a token, an unknown dbt version, or an unexpected
 * field is unreadable rather than silently trimmed, so a corruption is loud.
 */
export const dbtConfigurationSchema = z
  .object({
    hasDbtMetadata: z.boolean(),
    dbtVersion: z.enum(["current", "legacy"]),
    dbtAccountId: z.string().trim().min(1).max(MAX_ID_LENGTH).optional(),
    dbtProjectId: z.string().trim().min(1).max(MAX_ID_LENGTH).optional(),
    dbtEnvironmentId: z.string().trim().min(1).max(MAX_ID_LENGTH).optional(),
    dbtCloudHostname: z
      .string()
      .trim()
      .min(1)
      .max(MAX_HOSTNAME_LENGTH)
      .optional(),
  })
  .strict();

export type OrganizationDbtConfiguration = z.infer<
  typeof dbtConfigurationSchema
>;

const storedRecordSchema = z
  .object({
    revision: z.number().int().min(0),
    config: dbtConfigurationSchema,
  })
  .strict();

export type DbtConfigRevision = {
  revision: number;
  config: OrganizationDbtConfiguration;
};

export type OrganizationDbtConfigState =
  | { status: "absent" }
  | ({ status: "configured" } & DbtConfigRevision);

function contextFailure(): never {
  return fail(
    "An authenticated member of the active workspace is required to change the workspace dbt connection.",
    { errorCode: "dbt_workspace_required", statusCode: 403 },
  );
}

function contextMismatch(): never {
  return fail(
    "The workspace dbt connection must be managed from the active workspace context.",
    { errorCode: "dbt_org_context_mismatch", statusCode: 403 },
  );
}

function configurationUnreadable(): never {
  return fail(
    "The saved dbt configuration could not be read. Open the workspace BigQuery connection and save the dbt settings again.",
    { errorCode: "dbt_configuration_unreadable", statusCode: 503 },
  );
}

function configurationStoreUnavailable(): never {
  return fail(
    "The saved dbt configuration could not be checked. Retry shortly.",
    { errorCode: "dbt_configuration_store_unavailable", statusCode: 503 },
  );
}

function tokenMissing(): never {
  return fail(
    "The workspace dbt Service token is missing. Save the dbt settings with a Service token.",
    { errorCode: "dbt_service_token_missing", statusCode: 409 },
  );
}

function tokenUnavailable(): never {
  return fail(
    "The workspace dbt Service token could not be read. Retry shortly.",
    { errorCode: "dbt_service_token_unavailable", statusCode: 503 },
  );
}

/**
 * The request-context half of the authorization: the scope is the
 * authenticated organization, never a caller-supplied id. Callers separately
 * establish membership and the operation's role requirements; this function
 * only proves that the request and credential contexts agree with them.
 */
export function requireExactDbtRequestContext({
  orgId,
  userEmail,
}: {
  orgId: string;
  userEmail: string;
}): { orgId: string; userEmail: string } {
  const normalizedEmail = userEmail.trim().toLowerCase();
  if (!orgId.trim() || !normalizedEmail) return contextFailure();
  const requestContext = getRequestContext();
  const credentialContext = getCredentialContext();
  if (
    !requestContext ||
    typeof requestContext.orgId !== "string" ||
    !requestContext.orgId ||
    typeof requestContext.userEmail !== "string" ||
    !requestContext.userEmail.trim()
  )
    return contextFailure();
  const requestEmail = requestContext.userEmail.trim().toLowerCase();
  const credentialEmail =
    credentialContext?.userEmail?.trim().toLowerCase() ?? "";
  if (
    requestContext.orgId !== orgId ||
    requestEmail !== normalizedEmail ||
    credentialContext?.orgId !== orgId ||
    credentialEmail !== normalizedEmail
  )
    return contextMismatch();
  return { orgId, userEmail: normalizedEmail };
}

/** The normalized email of the caller, or a 403 when there is none. */
export function requireDbtUserEmail(): string {
  const userEmail = getRequestUserEmail()?.trim().toLowerCase();
  if (!userEmail) return contextFailure();
  return userEmail;
}

function parseStoredDbtConfig(
  value: Record<string, unknown> | null,
): OrganizationDbtConfigState {
  if (value === null) return { status: "absent" };
  const parsed = storedRecordSchema.safeParse(value);
  if (!parsed.success) return configurationUnreadable();
  return { status: "configured", ...parsed.data };
}

/**
 * Read the nonsecret dbt configuration for one organization. An absent row is
 * a normal state; a row that does not parse, or a store that cannot be read, is
 * reported as a failure rather than as "not configured".
 */
export async function readOrganizationDbtConfig(
  orgId: string,
): Promise<OrganizationDbtConfigState> {
  let stored: Record<string, unknown> | null;
  try {
    // `bypassCache` is required: the metadata action re-reads this revision
    // after a provider call to detect a save from another request, and the
    // per-request settings snapshot would otherwise replay the old value.
    stored = await getOrgSetting(orgId, ORGANIZATION_BIGQUERY_DBT_SETTING_KEY, {
      bypassCache: true,
    });
  } catch {
    return configurationStoreUnavailable();
  }
  return parseStoredDbtConfig(stored);
}

/**
 * The config revision is the only optimistic fence this app owns. It does not
 * fence a rotation of the shared vault slot itself: a token written through
 * Settings is re-read from the request-scoped vault cache for the rest of this
 * request, so a read started before that rotation can still use the previous
 * token. Closing that window needs a public vault-version check (for example a
 * `readAppSecretVersion` comparison) in a later leaf; do not claim a global
 * compare-and-swap here.
 */

/** Only the exact org-scoped vault slot. Absent is 409, unreadable is 503. */
export async function readDbtServiceToken(orgId: string): Promise<string> {
  let stored: Awaited<ReturnType<typeof readAppSecret>>;
  try {
    stored = await readAppSecret({
      key: DBT_SERVICE_TOKEN_KEY,
      scope: "org",
      scopeId: orgId,
    });
  } catch {
    return tokenUnavailable();
  }
  const token = stored?.value?.trim();
  if (!token) return tokenMissing();
  return token;
}

/**
 * Whether the exact org-scoped slot holds a token, without decrypting or
 * returning it. Metadata only: no value, last4 or manifest leaves this call.
 */
export async function getDbtServiceTokenState(
  orgId: string,
): Promise<{ tokenConfigured: boolean }> {
  let meta: Awaited<ReturnType<typeof readAppSecretMeta>>;
  try {
    meta = await readAppSecretMeta({
      key: DBT_SERVICE_TOKEN_KEY,
      scope: "org",
      scopeId: orgId,
    });
  } catch {
    return tokenUnavailable();
  }
  return { tokenConfigured: meta !== null };
}

/** Write the exact org-scoped slot. The token is never echoed or logged. */
export async function writeDbtServiceToken({
  orgId,
  token,
}: {
  orgId: string;
  token: string;
}): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed)
    fail("Enter the dbt Service token for this workspace.", {
      errorCode: "dbt_service_token_required",
      statusCode: 422,
    });
  try {
    await writeAppSecret({
      key: DBT_SERVICE_TOKEN_KEY,
      scope: "org",
      scopeId: orgId,
      value: trimmed,
    });
  } catch {
    return tokenUnavailable();
  }
}

export async function withOrganizationDbtTransaction<T>(
  run: (tx: DbExec) => Promise<T>,
): Promise<T> {
  // The delegated curator read must join the held connection's Drizzle scope.
  const db = getDb();
  if (typeof db.transaction !== "function")
    fail(
      "The workspace store cannot run this save atomically right now, so nothing was changed. Retry shortly.",
      { errorCode: "dbt_transaction_unavailable", statusCode: 503 },
    );
  return db.transaction(async () => run(getDbExec()));
}

/**
 * Compare-and-swap the configuration revision inside the caller's
 * transaction. The stored value is re-read through `mutateOrgSetting` so a
 * concurrent save loses with 409 instead of overwriting a newer config.
 */
export async function commitDbtConfigRevision({
  orgId,
  config,
  expectedRevision,
  transaction,
}: {
  orgId: string;
  config: OrganizationDbtConfiguration;
  expectedRevision: number;
  transaction: DbExec;
}): Promise<number> {
  // The public helper forwards its options to the settings store, where the
  // transaction handle is the documented option. The parameter type only
  // declares the optional write flags, so the structural value is widened
  // explicitly rather than cast.
  const mutationOptions: StoreWriteOptions & { transaction: DbExec } = {
    transaction,
  };
  const committed = await mutateOrgSetting(
    orgId,
    ORGANIZATION_BIGQUERY_DBT_SETTING_KEY,
    (current) => {
      const state = parseStoredDbtConfig(current);
      const currentRevision = state.status === "absent" ? 0 : state.revision;
      if (currentRevision !== expectedRevision)
        fail(
          "The dbt settings changed since this form was opened. Reload the connection settings and save again.",
          { errorCode: "dbt_configuration_stale", statusCode: 409 },
        );
      return {
        revision: currentRevision + 1,
        config: { ...config },
      };
    },
    mutationOptions,
  );
  const parsed = storedRecordSchema.safeParse(committed);
  if (!parsed.success) return configurationUnreadable();
  return parsed.data.revision;
}

/**
 * The exact public shape this app persists and returns: the provider's
 * `DbtConfiguration` fields, no token, no last4, no manifest.
 */
export function sanitizeDbtConfiguration(
  config: OrganizationDbtConfiguration,
): OrganizationDbtConfiguration {
  return {
    hasDbtMetadata: config.hasDbtMetadata,
    dbtVersion: config.dbtVersion,
    ...(config.dbtAccountId !== undefined && {
      dbtAccountId: config.dbtAccountId,
    }),
    ...(config.dbtProjectId !== undefined && {
      dbtProjectId: config.dbtProjectId,
    }),
    ...(config.dbtEnvironmentId !== undefined && {
      dbtEnvironmentId: config.dbtEnvironmentId,
    }),
    ...(config.dbtCloudHostname !== undefined && {
      dbtCloudHostname: config.dbtCloudHostname,
    }),
  };
}

/** A sanitized snapshot for read actions: config, revision, no secret. */
export async function readOrganizationDbtConfigView(orgId: string): Promise<{
  revision: number | null;
  config: OrganizationDbtConfiguration | null;
  dbtEnabled: boolean;
}> {
  const state = await readOrganizationDbtConfig(orgId);
  if (state.status === "absent")
    return { revision: null, config: null, dbtEnabled: false };
  return {
    revision: state.revision,
    config: sanitizeDbtConfiguration(state.config),
    dbtEnabled: state.config.hasDbtMetadata,
  };
}
