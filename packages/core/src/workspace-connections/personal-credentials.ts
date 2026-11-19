/**
 * Personal workspace credential creation and saved identity lookup.
 *
 * A trusted server caller configures this service with the app id it writes
 * for. Every other input is derived from the strict request context and the
 * operation itself; the per-call input cannot name an owner, org, scope,
 * namespace, app, or storage location.
 *
 * The service writes three things in one native transaction:
 *   1. encrypted secret values under the connection's internal vault namespace
 *   2. an owned personal connection whose refs use the locked marker
 *   3. the explicit grant that lets the configured app resolve those refs
 *
 * This slice intentionally ships no action or UI wrapper. A future wrapper must
 * be private, UI-only, non-tool, and non-persistent, must set recordInputs to
 * false, and must have a test proving secret values do not enter tracing or
 * history. None of those wrapper properties are implemented or verified here.
 */

import { createHash } from "node:crypto";

import { actionFailureEffect, isNoWriteError } from "../action.js";
import { getWorkspaceConnectionProvider } from "../connections/catalog.js";
import { getDbExec, isUniqueViolation, withDbExec } from "../db/client.js";
import {
  getRequiredSecret,
  type RegisteredSecret,
} from "../secrets/register.js";
import {
  ensureTable as ensureAppSecretsTable,
  readAppSecret,
  writeAppSecret,
} from "../secrets/storage.js";
import {
  personalProviderKeyWriteDenial,
  readOrgMemberRole,
} from "../server/personal-provider-key-policy.js";
import { getRequestContext } from "../server/request-context.js";
import {
  CONNECTION_CREDENTIAL_REF_MARKER,
  connectionCredentialScopeId,
} from "./credential-profile.js";
import {
  createPersonalCredentialProviderSnapshot,
  readPersonalCredentialDataRecord,
  readPersonalCredentialDataArray,
  type PersonalCredentialProviderDefinition,
} from "./personal-provider-definitions.js";
import {
  ensureWorkspaceConnectionsTable,
  getWorkspaceConnection,
  getWorkspaceConnectionGrant,
  upsertWorkspaceConnection,
  upsertWorkspaceConnectionGrant,
  type SerializedWorkspaceConnection,
  type SerializedWorkspaceConnectionGrant,
  type WorkspaceConnectionCredentialRef,
} from "./store.js";

export type { PersonalCredentialProviderDefinition } from "./personal-provider-definitions.js";

export type PersonalWorkspaceCredentialConfigValue = string | number | boolean;

export interface PersonalWorkspaceCredentialValidationInput {
  readonly provider: string;
  readonly config: Readonly<
    Record<string, PersonalWorkspaceCredentialConfigValue>
  >;
  readonly secretValues: ReadonlyArray<
    Readonly<{ key: string; secret: string }>
  >;
}

export interface CreatePersonalWorkspaceCredentialInput {
  /** Immutable identity of one create operation. Reusing it must replay. */
  operationId: string;
  provider: string;
  /** Optional display name. Defaults to the native provider label. */
  name?: string;
  /** Flat provider-declared configuration. Unknown keys are rejected. */
  config?: Record<string, PersonalWorkspaceCredentialConfigValue>;
  secretValues: ReadonlyArray<{ key: string; secret: string }>;
}

export interface PersonalWorkspaceCredentialServiceOptions {
  appId: string;
  /**
   * Trusted server-only additional credential definitions. Snapshotted and
   * frozen at factory time; never read from the per-call input.
   */
  providers?: readonly PersonalCredentialProviderDefinition[];
  /**
   * Trusted server-only, read-only provider check on the exact normalized
   * values. Throw to reject. Runs before persistence and outside transactions;
   * replays validate again. The caller must bound its network requests and must
   * never log the input or retain its plaintext values.
   */
  validateCredentials?: (
    input: PersonalWorkspaceCredentialValidationInput,
  ) => Promise<void>;
}

export interface PersonalWorkspaceCredentialService {
  create(
    input: CreatePersonalWorkspaceCredentialInput,
  ): Promise<{ connectionId: string }>;
  /** Reads a currently saved identity, without validating or returning secrets. */
  findCreatedConnection(input: {
    operationId: string;
  }): Promise<{ connectionId: string } | null>;
}

export type PersonalWorkspaceCredentialErrorCode =
  | "invalid_input"
  | "unauthenticated"
  | "forbidden"
  | "unsupported_provider"
  | "unsupported_credential"
  | "validator_rejected"
  | "conflict"
  | "refused"
  | "transaction_unavailable"
  | "write_failed"
  | "lookup_failed";

const ERROR_STATUS: Record<PersonalWorkspaceCredentialErrorCode, number> = {
  invalid_input: 400,
  unauthenticated: 401,
  forbidden: 403,
  unsupported_provider: 400,
  unsupported_credential: 400,
  validator_rejected: 400,
  conflict: 409,
  refused: 409,
  transaction_unavailable: 503,
  write_failed: 500,
  lookup_failed: 503,
};

const ERROR_MESSAGE: Record<PersonalWorkspaceCredentialErrorCode, string> = {
  invalid_input: "The personal workspace credential input is invalid.",
  unauthenticated:
    "Personal workspace credentials require an authenticated request context.",
  forbidden: "Personal workspace credential creation is not allowed.",
  unsupported_provider:
    "This provider is not supported by personal workspace credentials.",
  unsupported_credential:
    "This credential is not supported by personal workspace credentials.",
  validator_rejected: "The credential value was rejected.",
  conflict:
    "This operation already exists with different immutable input or values.",
  refused: "The personal workspace credential request was refused.",
  transaction_unavailable:
    "Personal workspace credentials require database transaction support.",
  write_failed:
    "The personal workspace credential outcome could not be confirmed.",
  lookup_failed:
    "The saved personal workspace credential identity could not be read.",
};

/** A deliberately closed error: no input values, refs, rows, or causes. */
export class PersonalWorkspaceCredentialError extends Error {
  readonly code: PersonalWorkspaceCredentialErrorCode;
  readonly statusCode: number;

  constructor(code: PersonalWorkspaceCredentialErrorCode, statusCode?: number) {
    super(ERROR_MESSAGE[code]);
    this.name = "PersonalWorkspaceCredentialError";
    this.code = code;
    this.statusCode = statusCode ?? ERROR_STATUS[code];
  }
}

const INPUT_KEYS = new Set([
  "operationId",
  "provider",
  "name",
  "config",
  "secretValues",
]);
const SECRET_VALUE_KEYS = new Set(["key", "secret"]);
const FACTORY_KEYS = new Set(["appId", "providers", "validateCredentials"]);

interface PersonalProviderLike {
  readonly id: string;
  readonly label: string;
  readonly credentialKeys: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly description?: string;
    readonly required?: boolean;
    readonly preserveWhitespace?: boolean;
  }>;
  readonly configurationFields?: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly description?: string;
    readonly required?: boolean;
    readonly defaultValue?: string;
  }>;
  readonly oauth?: unknown;
}

interface PersonalWorkspaceCredentialServiceConfig {
  appId: string;
  providers: readonly PersonalCredentialProviderDefinition[];
  validateCredentials?: PersonalWorkspaceCredentialServiceOptions["validateCredentials"];
}

interface StrictActor {
  email: string;
  orgId: string | null;
}

interface PreparedSecret {
  key: string;
  value: string;
  registered: RegisteredSecret | undefined;
}

interface PreparedCreate {
  appId: string;
  actor: StrictActor;
  operationId: string;
  connectionId: string;
  namespace: string;
  provider: string;
  name: string;
  storedConfig: Record<string, unknown>;
  secrets: PreparedSecret[];
  refs: WorkspaceConnectionCredentialRef[];
}

function fail(code: PersonalWorkspaceCredentialErrorCode): never {
  throw new PersonalWorkspaceCredentialError(code);
}

function failRefusal(statusCode: number | undefined): never {
  throw new PersonalWorkspaceCredentialError("refused", statusCode);
}

function readRefusalStatus(error: unknown): number | undefined {
  if (!error || (typeof error !== "object" && typeof error !== "function")) {
    return undefined;
  }
  const candidate = error as { statusCode?: unknown; status?: unknown };
  for (const key of ["statusCode", "status"] as const) {
    const status = candidate[key];
    if (
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 400 &&
      status < 500
    ) {
      return status;
    }
  }
  return undefined;
}

/**
 * Evidence that the failure is an explicit refusal, not an unknown outcome.
 * Only supported native predicates and an explicit 4xx status are trusted.
 * Reading either can throw; an unreadable classification stays closed and
 * still stops without a readback.
 */
function classifyRefusal(
  error: unknown,
): { status?: number | undefined } | null {
  try {
    if (isNoWriteError(error)) {
      return { status: readRefusalStatus(error) };
    }
    if (actionFailureEffect(error) === "none") {
      return { status: readRefusalStatus(error) };
    }
    const status = readRefusalStatus(error);
    return status === undefined ? null : { status };
  } catch {
    // coercion-ok: an unreadable classification stays closed, as documented above
    return {};
  }
}

function isPersonalCredentialError(
  error: unknown,
): error is PersonalWorkspaceCredentialError {
  try {
    return error instanceof PersonalWorkspaceCredentialError;
  } catch {
    // coercion-ok: a hostile proxy that throws on instanceof is not our error
    return false;
  }
}

function isExistingRowConflict(error: unknown): boolean {
  try {
    if (isUniqueViolation(error)) return true;
    // The native connection/grant upserts translate a unique-key conflict into a
    // fixed message. Keep that translation closed: only the classification is
    // reused here, never the message or any row data.
    return (
      error instanceof Error &&
      error.message.includes("already exists outside the current request scope")
    );
  } catch {
    // coercion-ok: an unreadable error is not a proven conflict; caller reports write_failed
    return false;
  }
}

function inputRecord(
  value: unknown,
  allowed?: ReadonlySet<string>,
): Record<string, unknown> {
  try {
    return readPersonalCredentialDataRecord(value, allowed);
  } catch {
    fail("invalid_input");
  }
}

function inputArray(value: unknown): unknown[] {
  try {
    return readPersonalCredentialDataArray(value);
  } catch {
    fail("invalid_input");
  }
}

function requiredString(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) fail("invalid_input");
  return normalized;
}

function normalizeConfig(
  value: unknown,
): Record<string, PersonalWorkspaceCredentialConfigValue> {
  if (value === undefined) return {};
  const record = inputRecord(value);
  const config: Record<string, PersonalWorkspaceCredentialConfigValue> = {};
  for (const [key, raw] of Object.entries(record)) {
    const normalizedKey = key.trim();
    if (!normalizedKey || normalizedKey !== key) fail("invalid_input");
    if (typeof raw === "string") {
      const normalized = raw.trim();
      if (!normalized) fail("invalid_input");
      config[normalizedKey] = normalized;
      continue;
    }
    if (typeof raw === "number") {
      if (!Number.isFinite(raw)) fail("invalid_input");
      config[normalizedKey] = raw;
      continue;
    }
    if (typeof raw === "boolean") {
      config[normalizedKey] = raw;
      continue;
    }
    fail("invalid_input");
  }
  return config;
}

function normalizeSecrets(
  value: unknown,
): Array<{ key: string; secret: string }> {
  const entries = inputArray(value);
  const seen = new Set<string>();
  const secrets: Array<{ key: string; secret: string }> = [];
  for (const rawEntry of entries) {
    const entry = inputRecord(rawEntry, SECRET_VALUE_KEYS);
    const key = requiredString(entry.key);
    const secret = typeof entry.secret === "string" ? entry.secret : "";
    if (!secret || seen.has(key)) fail("invalid_input");
    seen.add(key);
    secrets.push({ key, secret });
  }
  return secrets;
}

function normalizeInput(raw: unknown): {
  operationId: string;
  provider: string;
  name: string | null;
  config: Record<string, PersonalWorkspaceCredentialConfigValue>;
  secrets: Array<{ key: string; secret: string }>;
} {
  const record = inputRecord(raw, INPUT_KEYS);
  const operationId = requiredString(record.operationId);
  const provider = requiredString(record.provider);
  let name: string | null = null;
  if (record.name !== undefined) {
    name = requiredString(record.name);
  }
  return {
    operationId,
    provider,
    name,
    config: normalizeConfig(record.config),
    secrets: normalizeSecrets(record.secretValues),
  };
}

function readStrictActor(): StrictActor {
  const context = getRequestContext();
  if (!context) fail("unauthenticated");
  const email =
    typeof context.userEmail === "string"
      ? context.userEmail.trim().toLowerCase()
      : "";
  if (!email) fail("unauthenticated");
  if (context.credentialScope !== undefined) fail("forbidden");
  if (context.orgId !== undefined) {
    if (
      typeof context.orgId !== "string" ||
      context.orgId.trim().length === 0
    ) {
      fail("forbidden");
    }
  }
  const orgId = typeof context.orgId === "string" ? context.orgId.trim() : null;
  return { email, orgId };
}

async function readMembershipRole(actor: StrictActor): Promise<string | null> {
  if (!actor.orgId) return null;
  let role: string | null;
  try {
    role = await readOrgMemberRole(actor.orgId, actor.email);
  } catch {
    fail("forbidden");
  }
  if (role !== "owner" && role !== "admin" && role !== "member") {
    fail("forbidden");
  }
  return role;
}

function deterministicConnectionId(input: {
  actor: StrictActor;
  appId: string;
  operationId: string;
}): string {
  const payload = JSON.stringify([
    input.actor.email.toLowerCase(),
    input.actor.orgId,
    input.appId,
    input.operationId,
  ]);
  return `pconn1:${createHash("sha256").update(payload).digest("hex")}`;
}

/** Builtin providers always win; custom definitions are consulted only after. */
function resolveProvider(
  id: string,
  customProviders: readonly PersonalCredentialProviderDefinition[],
): PersonalProviderLike | undefined {
  const builtin = getWorkspaceConnectionProvider(id);
  const custom = customProviders.find((provider) => provider.id === id);
  if (builtin && custom) fail("unsupported_provider");
  return builtin ?? custom;
}

function catalogConfig(
  provider: PersonalProviderLike | undefined,
  input: Partial<Record<string, PersonalWorkspaceCredentialConfigValue>>,
): Record<string, PersonalWorkspaceCredentialConfigValue> {
  if (!provider) fail("unsupported_provider");
  const fields = new Map(
    (provider.configurationFields ?? []).map((field) => [field.key, field]),
  );
  for (const key of Object.keys(input)) {
    if (!fields.has(key)) fail("invalid_input");
  }
  const config: Record<string, PersonalWorkspaceCredentialConfigValue> = {};
  for (const field of fields.values()) {
    const supplied = Object.hasOwn(input, field.key)
      ? input[field.key]
      : undefined;
    if (supplied !== undefined) {
      config[field.key] = supplied;
      continue;
    }
    if (field.defaultValue !== undefined) {
      config[field.key] = field.defaultValue;
      continue;
    }
    if (field.required) fail("invalid_input");
  }
  return config;
}

function catalogSecrets(
  provider: PersonalProviderLike | undefined,
  input: Array<{ key: string; secret: string }>,
): PreparedSecret[] {
  if (!provider) fail("unsupported_provider");
  if (provider.oauth) fail("unsupported_provider");
  const keys = new Map(
    provider.credentialKeys.map((credential) => [credential.key, credential]),
  );
  const supplied = new Map(input.map((entry) => [entry.key, entry.secret]));
  for (const key of supplied.keys()) {
    if (!keys.has(key)) fail("invalid_input");
  }
  const prepared: PreparedSecret[] = [];
  for (const credential of provider.credentialKeys) {
    const raw = supplied.get(credential.key);
    if (raw === undefined) {
      if (credential.required) fail("invalid_input");
      continue;
    }
    const value = credential.preserveWhitespace === true ? raw : raw.trim();
    if (!value) fail("invalid_input");
    const registered = getRequiredSecret(credential.key);
    if (registered) {
      if (registered.kind !== "api-key" || registered.scope !== "user") {
        fail("unsupported_credential");
      }
    }
    prepared.push({
      key: credential.key,
      value,
      registered,
    });
  }
  prepared.sort((left, right) => left.key.localeCompare(right.key));
  return prepared;
}

async function runNativeValidator(secret: PreparedSecret): Promise<void> {
  const validator = secret.registered?.validator;
  if (!validator) return;
  try {
    const result = await validator(secret.value);
    const ok = typeof result === "boolean" ? result : result.ok === true;
    if (ok) return;
  } catch {
    fail("validator_rejected");
  }
  fail("validator_rejected");
}

function policyScope(
  actor: StrictActor,
  role: string | null,
): { orgId?: string; role?: string } {
  if (!actor.orgId) return {};
  return {
    orgId: actor.orgId,
    ...(role ? { role } : {}),
  };
}

async function authorizeWrites(prepared: {
  actor: StrictActor;
  secrets: ReadonlyArray<Pick<PreparedSecret, "key">>;
}): Promise<void> {
  const strictActor = readStrictActor();
  if (
    strictActor.email !== prepared.actor.email ||
    strictActor.orgId !== prepared.actor.orgId
  ) {
    fail("forbidden");
  }
  const role = await readMembershipRole(prepared.actor);
  const scope = policyScope(prepared.actor, role);
  for (const secret of prepared.secrets) {
    const registered = getRequiredSecret(secret.key);
    if (
      registered &&
      (registered.kind !== "api-key" || registered.scope !== "user")
    ) {
      fail("unsupported_credential");
    }
    let denial: string | null;
    try {
      denial = await personalProviderKeyWriteDenial({
        key: secret.key,
        email: prepared.actor.email,
        ...scope,
        fresh: true,
      });
    } catch {
      fail("forbidden");
    }
    if (denial) fail("forbidden");
  }
}

function buildRefs(
  provider: string,
  secrets: PreparedSecret[],
): WorkspaceConnectionCredentialRef[] {
  return secrets.map(({ key }) => ({
    key,
    scope: "user" as const,
    provider,
    ref: CONNECTION_CREDENTIAL_REF_MARKER,
  }));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(",")}]`;
  }
  if (isPlainRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stringArrayEquals(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function refsMatch(
  actual: WorkspaceConnectionCredentialRef[],
  expected: WorkspaceConnectionCredentialRef[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((ref, index) => {
      const wanted = expected.at(index);
      if (!wanted) return false;
      return (
        ref.key === wanted.key &&
        ref.scope === wanted.scope &&
        ref.provider === wanted.provider &&
        ref.ref === wanted.ref
      );
    })
  );
}

function connectionMatches(
  connection: SerializedWorkspaceConnection,
  prepared: PreparedCreate,
): boolean {
  return (
    connection.provider === prepared.provider &&
    connection.label === prepared.name &&
    connection.accountId === null &&
    connection.accountLabel === null &&
    connection.status === "connected" &&
    stringArrayEquals(connection.scopes, []) &&
    stableValue(connection.config) === stableValue(prepared.storedConfig) &&
    stringArrayEquals(connection.allowedApps, [prepared.appId]) &&
    stringArrayEquals(connection.allowedUsers, [prepared.actor.email]) &&
    stringArrayEquals(connection.allowedUserGroups ?? [], []) &&
    refsMatch(connection.credentialRefs, prepared.refs) &&
    connection.ownerEmail.trim().toLowerCase() === prepared.actor.email &&
    connection.orgId === prepared.actor.orgId
  );
}

function grantMatches(
  grant: SerializedWorkspaceConnectionGrant,
  prepared: PreparedCreate,
): boolean {
  return (
    grant.connectionId === prepared.connectionId &&
    grant.appId === prepared.appId &&
    grant.provider === prepared.provider &&
    stringArrayEquals(grant.scopes, []) &&
    stableValue(grant.config) === stableValue(prepared.storedConfig) &&
    refsMatch(grant.credentialRefs, prepared.refs) &&
    grant.grantedByEmail.trim().toLowerCase() === prepared.actor.email &&
    grant.ownerEmail.trim().toLowerCase() === prepared.actor.email &&
    grant.orgId === prepared.actor.orgId
  );
}

async function secretValuesMatch(prepared: PreparedCreate): Promise<boolean> {
  for (const secret of prepared.secrets) {
    const stored = await readAppSecret({
      key: secret.key,
      scope: "user",
      scopeId: prepared.namespace,
    });
    if (!stored || stored.value !== secret.value) return false;
  }
  return true;
}

function savedIdentityMatches(
  connection: SerializedWorkspaceConnection,
  grant: SerializedWorkspaceConnectionGrant,
  connectionId: string,
  appId: string,
  actor: StrictActor,
): boolean {
  const refs = connection.credentialRefs;
  return !(
    connection.id !== connectionId ||
    connection.ownerEmail.trim().toLowerCase() !== actor.email ||
    connection.orgId !== actor.orgId ||
    connection.status !== "connected" ||
    connection.accountId !== null ||
    connection.accountLabel !== null ||
    !stringArrayEquals(connection.scopes, []) ||
    !stringArrayEquals(grant.scopes, []) ||
    stableValue(connection.config) !== stableValue(grant.config) ||
    connection.config.workspaceConnectionScope !== "user" ||
    !stringArrayEquals(connection.allowedApps, [appId]) ||
    !stringArrayEquals(connection.allowedUsers, [actor.email]) ||
    !stringArrayEquals(connection.allowedUserGroups ?? [], []) ||
    refs.some(
      (ref) =>
        ref.scope !== "user" ||
        ref.provider !== connection.provider ||
        ref.ref !== CONNECTION_CREDENTIAL_REF_MARKER,
    ) ||
    new Set(refs.map((ref) => ref.key)).size !== refs.length ||
    grant.connectionId !== connectionId ||
    grant.appId !== appId ||
    grant.provider !== connection.provider ||
    grant.ownerEmail.trim().toLowerCase() !== actor.email ||
    grant.grantedByEmail.trim().toLowerCase() !== actor.email ||
    grant.orgId !== actor.orgId ||
    grant.config.workspaceConnectionScope !== "user" ||
    !refsMatch(grant.credentialRefs, refs)
  );
}

type ExistingState = "absent" | "match" | "conflict";

async function inspectExisting(
  prepared: PreparedCreate,
): Promise<ExistingState> {
  const connection = await getWorkspaceConnection(prepared.connectionId);
  const grant = await getWorkspaceConnectionGrant(
    prepared.connectionId,
    prepared.appId,
  );
  if (!connection && !grant) return "absent";
  if (!connection || !grant) return "conflict";
  if (
    !savedIdentityMatches(
      connection,
      grant,
      prepared.connectionId,
      prepared.appId,
      prepared.actor,
    )
  )
    return "conflict";
  if (!connectionMatches(connection, prepared)) return "conflict";
  if (!grantMatches(grant, prepared)) return "conflict";
  if (!(await secretValuesMatch(prepared))) return "conflict";
  return "match";
}

async function prewarmNativeStores(): Promise<void> {
  try {
    await ensureWorkspaceConnectionsTable();
    await ensureAppSecretsTable();
  } catch {
    fail("write_failed");
  }
}

async function writePrepared(prepared: PreparedCreate): Promise<void> {
  for (const secret of prepared.secrets) {
    await writeAppSecret({
      key: secret.key,
      value: secret.value,
      scope: "user",
      scopeId: prepared.namespace,
    });
  }
  await upsertWorkspaceConnection({
    id: prepared.connectionId,
    provider: prepared.provider,
    label: prepared.name,
    accountId: null,
    accountLabel: null,
    status: "connected",
    scopes: [],
    config: prepared.storedConfig,
    allowedApps: [prepared.appId],
    allowedUsers: [prepared.actor.email],
    allowedUserGroups: [],
    credentialRefs: prepared.refs,
  });
  await upsertWorkspaceConnectionGrant({
    connectionId: prepared.connectionId,
    appId: prepared.appId,
    provider: prepared.provider,
    scopes: [],
    config: prepared.storedConfig,
    credentialRefs: prepared.refs,
  });
}

async function prepareCreate(
  raw: unknown,
  serviceConfig: PersonalWorkspaceCredentialServiceConfig,
): Promise<PreparedCreate> {
  const { appId } = serviceConfig;
  const input = normalizeInput(raw);
  const actor = readStrictActor();
  await readMembershipRole(actor);
  const provider = resolveProvider(input.provider, serviceConfig.providers);
  if (!provider) fail("unsupported_provider");
  if (provider.oauth) fail("unsupported_provider");
  const config = catalogConfig(provider, input.config);
  const secrets = catalogSecrets(provider, input.secrets);

  await authorizeWrites({ actor, secrets });
  // A prior async validator can outlive policy or membership authorization.
  // Refresh immediately before each validator receives any plaintext value.
  for (const secret of secrets) {
    await authorizeWrites({ actor, secrets: [secret] });
    await runNativeValidator(secret);
  }

  if (serviceConfig.validateCredentials) {
    await authorizeWrites({ actor, secrets });
    const validationInput: PersonalWorkspaceCredentialValidationInput =
      Object.freeze({
        provider: provider.id,
        config: Object.freeze({ ...config }),
        secretValues: Object.freeze(
          secrets.map(({ key, value }) =>
            Object.freeze({ key, secret: value }),
          ),
        ),
      });
    try {
      const result = await serviceConfig.validateCredentials(validationInput);
      if (result !== undefined) fail("validator_rejected");
    } catch {
      // Provider errors can contain credentials; retain no message or cause.
      fail("validator_rejected");
    }
    await authorizeWrites({ actor, secrets });
  }

  const operationId = input.operationId;
  const connectionId = deterministicConnectionId({
    actor,
    appId,
    operationId,
  });
  const namespace = connectionCredentialScopeId({
    id: connectionId,
    ownerEmail: actor.email,
    orgId: actor.orgId,
  });
  const storedConfig: Record<string, unknown> = {
    ...config,
    workspaceConnectionScope: "user",
  };
  return {
    appId,
    actor,
    operationId,
    connectionId,
    namespace,
    provider: provider.id,
    name: input.name ?? provider.label,
    storedConfig,
    secrets,
    refs: buildRefs(provider.id, secrets),
  };
}

function validateFactoryOptions(
  raw: unknown,
): PersonalWorkspaceCredentialServiceConfig {
  const record = inputRecord(raw, FACTORY_KEYS);
  const appId = requiredString(record.appId);
  if (
    record.validateCredentials !== undefined &&
    typeof record.validateCredentials !== "function"
  )
    fail("invalid_input");
  let providers: readonly PersonalCredentialProviderDefinition[] = [];
  if (record.providers !== undefined) {
    try {
      providers = createPersonalCredentialProviderSnapshot(record.providers);
    } catch {
      fail("invalid_input");
    }
  }
  return {
    appId,
    providers,
    ...(record.validateCredentials === undefined
      ? {}
      : {
          validateCredentials: record.validateCredentials as NonNullable<
            PersonalWorkspaceCredentialServiceOptions["validateCredentials"]
          >,
        }),
  };
}

/**
 * Build a personal credential service for one configured app. Saved identity
 * lookup is independent of create acknowledgement and never reads secret values.
 */
export function createPersonalWorkspaceCredentialService(
  options: PersonalWorkspaceCredentialServiceOptions,
): PersonalWorkspaceCredentialService {
  const config = validateFactoryOptions(options);

  return Object.freeze({
    async findCreatedConnection(input: { operationId: string }) {
      const record = inputRecord(input, new Set(["operationId"]));
      const operationId = requiredString(record.operationId);
      const actor = readStrictActor();
      const authUserId = getRequestContext()?.authUserId;
      const authorizeLookup = async (
        keys: ReadonlyArray<Pick<PreparedSecret, "key">>,
      ) => {
        await authorizeWrites({ actor, secrets: keys });
        await readMembershipRole(actor);
        const currentActor = readStrictActor();
        if (
          currentActor.email !== actor.email ||
          currentActor.orgId !== actor.orgId ||
          getRequestContext()?.authUserId !== authUserId
        )
          fail("forbidden");
      };
      await authorizeLookup([]);
      const connectionId = deterministicConnectionId({
        actor,
        appId: config.appId,
        operationId,
      });
      let connection: SerializedWorkspaceConnection | null;
      let grant: SerializedWorkspaceConnectionGrant | null;
      try {
        connection = await getWorkspaceConnection(connectionId);
        grant = await getWorkspaceConnectionGrant(connectionId, config.appId);
      } catch {
        fail("lookup_failed");
      }
      // Lookup confirms a current saved record, not the outcome of a prior
      // HTTP call. A refused create must remain refused even if a row exists.
      if (!connection && !grant) {
        await authorizeLookup([]);
        return null;
      }
      if (!connection || !grant) fail("conflict");
      if (
        !savedIdentityMatches(
          connection,
          grant,
          connectionId,
          config.appId,
          actor,
        )
      )
        fail("conflict");
      const refs = connection.credentialRefs;
      await authorizeLookup(refs);
      return { connectionId };
    },
    async create(input: CreatePersonalWorkspaceCredentialInput) {
      const prepared = await prepareCreate(input, config);

      // Prewarm the native stores before the transaction. Helper readiness
      // then finds the domain schema already applied; nothing rolled back can
      // leave a memoized "ready" promise for tables this transaction created.
      await prewarmNativeStores();

      // Prewarming can take long enough for identity, membership, or policy to
      // change. Re-check before inspecting existing state so a fast replay
      // never reads credential values under stale authorization.
      await authorizeWrites(prepared);
      const before = await inspectExisting(prepared).catch(() => {
        fail("write_failed");
      });
      if (before === "match") {
        return { connectionId: prepared.connectionId };
      }
      if (before === "conflict") fail("conflict");

      const exec = getDbExec();
      if (typeof exec.transaction !== "function") {
        fail("transaction_unavailable");
      }

      try {
        await exec.transaction(async (tx) => {
          await withDbExec(tx, async () => {
            // Serialize writers for one deterministic operation id. Without
            // this lock, the native connection upsert could see a row inserted
            // by a racing transaction after our in-transaction read and take
            // its UPDATE path, overwriting instead of replay-conflicting.
            await tx.execute({
              sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
              args: [`personal-workspace-credential:${prepared.connectionId}`],
            });

            // A lock wait can outlive the checks in prepareCreate. Re-check
            // current identity, membership, native scope/kind, and a fresh
            // read of the personal-key policy before either returning a replay
            // match or writing.
            await authorizeWrites(prepared);
            const current = await inspectExisting(prepared);
            if (current === "match") return;
            if (current === "conflict") fail("conflict");

            await writePrepared(prepared);
          });
        });
      } catch (error) {
        if (isPersonalCredentialError(error)) throw error;

        // An explicit refusal stops here: never reconcile, and never return a
        // committed row as success after a native no-write or 4xx refusal.
        const refusal = classifyRefusal(error);
        if (refusal) failRefusal(refusal.status);

        // One read-only reconciliation for an ambiguous transaction outcome
        // (for example, a commit whose acknowledgement failed).
        // The acknowledgement can be lost after identity or policy changed.
        // Reauthorize before inspecting or decrypting any committed values.
        await authorizeWrites(prepared);
        const reconciled = await inspectExisting(prepared).catch(
          () => "absent" as const,
        );
        if (reconciled === "match") {
          return { connectionId: prepared.connectionId };
        }
        if (isExistingRowConflict(error) || reconciled === "conflict") {
          fail("conflict");
        }
        fail("write_failed");
      }

      return { connectionId: prepared.connectionId };
    },
  });
}
