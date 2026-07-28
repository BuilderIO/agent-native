import { resolveProviderApiOAuthAccessToken } from "@agent-native/core/provider-api";
import {
  resolveWorkspaceConnectionCredentialForApp,
  resolveWorkspaceConnectionForApp,
  type ResolvedWorkspaceConnectionForApp,
  type WorkspaceConnectionForApp,
} from "@agent-native/core/workspace-connections";

import type {
  CrmAccessScope,
  CrmAdapter,
  CrmAdapterCapabilities,
  CrmConnectionRef,
  CrmFieldDefinition,
  CrmObjectDefinition,
  CrmObjectKind,
  CrmProvenance,
  CrmRecord,
  CrmRecordRef,
  CrmRelationship,
  CrmSyncPage,
  CrmValue,
} from "../../shared/crm-contract.js";

const CRM_APP_ID = "crm";
const SALESFORCE_CREDENTIAL_KEYS = [
  "SALESFORCE_ACCESS_TOKEN",
  "SALESFORCE_OAUTH_TOKEN",
] as const;
const CORE_OBJECT_TYPES = ["Account", "Contact", "Opportunity"] as const;
const MAX_PAGE_SIZE = 200;
const MAX_DISCOVERED_OBJECTS = 100;
const DISCOVERY_CONCURRENCY = 5;
const MAX_RETRY_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 1_500;
const MAX_SINGLE_RETRY_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_API_VERSION = "v60.0";
const SAFE_OBJECT_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const SAFE_FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface SalesforceTransportRequest {
  path: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  retrySafe?: boolean;
}

export interface SalesforceTransportResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string | undefined>;
}

export interface SalesforceTransport {
  request(
    input: SalesforceTransportRequest,
  ): Promise<SalesforceTransportResponse>;
}

export interface SalesforceCrmAdapterOptions {
  connection: WorkspaceConnectionForApp;
  transport: SalesforceTransport;
}

export interface CreateSalesforceCrmAdapterOptions {
  connectionId?: string;
  userEmail?: string;
  orgId?: string | null;
  transport?: SalesforceTransport;
}

type SalesforceField = {
  name?: string;
  label?: string;
  type?: string;
  accessible?: boolean;
  createable?: boolean;
  updateable?: boolean;
  nillable?: boolean;
  defaultedOnCreate?: boolean;
  calculated?: boolean;
  encrypted?: boolean;
  restrictedPicklist?: boolean;
  picklistValues?: Array<{
    value?: string;
    label?: string;
    active?: boolean;
  }>;
  referenceTo?: string[];
  relationshipName?: string;
};

type SalesforceObjectDescription = {
  name?: string;
  label?: string;
  labelPlural?: string;
  custom?: boolean;
  queryable?: boolean;
  searchable?: boolean;
  createable?: boolean;
  updateable?: boolean;
  deletable?: boolean;
  fields?: SalesforceField[];
};

type SalesforceGlobalObject = {
  name?: string;
  label?: string;
  custom?: boolean;
  queryable?: boolean;
};

type SalesforceRecord = Record<string, unknown> & {
  Id?: string;
  SystemModstamp?: string;
  LastModifiedDate?: string;
  IsDeleted?: boolean;
};

type SalesforceQueryResponse = {
  records?: SalesforceRecord[];
  done?: boolean;
  nextRecordsUrl?: string;
};

function nonEmpty(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function assertSafeObjectType(value: string): string {
  const objectType = nonEmpty(value);
  if (!objectType || !SAFE_OBJECT_NAME.test(objectType)) {
    throw new Error("Salesforce objectType contains unsupported characters.");
  }
  return objectType;
}

function safeFields(fields: readonly string[]): string[] {
  return uniqueStrings(fields).filter((field) => SAFE_FIELD_NAME.test(field));
}

function objectKind(objectType: string): CrmObjectKind {
  switch (objectType.toLowerCase()) {
    case "account":
      return "account";
    case "contact":
    case "lead":
      return "person";
    case "opportunity":
      return "opportunity";
    case "task":
      return "task";
    case "event":
    case "case":
      return "activity";
    default:
      return "custom";
  }
}

function displayFields(objectType: string): string[] {
  switch (objectType.toLowerCase()) {
    case "account":
      return ["Name", "Website"];
    case "contact":
      return ["FirstName", "LastName", "Email"];
    case "opportunity":
      return ["Name"];
    case "lead":
      return ["FirstName", "LastName", "Email"];
    default:
      return ["Name"];
  }
}

function searchField(objectType: string): string {
  switch (objectType.toLowerCase()) {
    case "task":
    case "event":
    case "case":
      return "Subject";
    default:
      return "Name";
  }
}

function fieldValueType(
  field: SalesforceField,
): CrmFieldDefinition["valueType"] {
  switch (field.type?.toLowerCase()) {
    case "boolean":
      return "boolean";
    case "currency":
      return "currency";
    case "percent":
      return "percent";
    case "double":
    case "int":
    case "long":
      return "number";
    case "date":
      return "date";
    case "datetime":
    case "time":
      return "datetime";
    case "picklist":
      return "enum";
    case "multipicklist":
      return "multi-enum";
    case "reference":
      return "reference";
    case "address":
    case "location":
    case "json":
      return "json";
    default:
      return "string";
  }
}

function isSensitiveField(field: SalesforceField): boolean {
  const name = field.name?.toLowerCase() ?? "";
  return (
    field.encrypted === true || /(password|secret|token|ssn|social)/.test(name)
  );
}

function scalarValue(value: unknown): CrmValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const entries = value.filter(
      (item): item is string | number | boolean | null =>
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    );
    return entries.length === value.length ? entries : undefined;
  }
  return undefined;
}

function encodedCursor(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeCursor<T>(cursor: string | undefined): T | null {
  if (!cursor) return null;
  try {
    const padded = cursor
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(cursor.length / 4) * 4, "=");
    const binary = atob(padded);
    return JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      ),
    ) as T;
  } catch {
    return null;
  }
}

function scopeAllows(
  connection: WorkspaceConnectionForApp,
  objectType: string,
  operation: "read" | "write",
): boolean {
  const scopes = [
    ...connection.scopes,
    ...(connection.explicitGrant?.scopes ?? []),
  ].map((scope) => scope.toLowerCase());
  if (scopes.length === 0) return operation === "read";
  const object = objectType.toLowerCase();
  return scopes.some(
    (scope) =>
      scope === "all" ||
      scope === "api" ||
      scope === "crm" ||
      scope === `crm.${operation}` ||
      scope === `crm.objects.${operation}` ||
      scope === `crm.objects.${object}.${operation}` ||
      (operation === "write" && scope.endsWith(".write")),
  );
}

function configurationValue(
  connection: WorkspaceConnectionForApp,
  keys: string[],
): string | undefined {
  const sources = [connection.explicitGrant?.config, connection.config];
  for (const source of sources) {
    for (const key of keys) {
      const value = source?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return undefined;
}

function resolveInstanceUrl(connection: WorkspaceConnectionForApp): string {
  const configured = configurationValue(connection, [
    "instanceUrl",
    "instance_url",
    "salesforceInstanceUrl",
  ]);
  if (!configured) {
    throw new Error(
      "Salesforce workspace connection is missing a trusted instance URL in connection metadata.",
    );
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(
      "Salesforce workspace connection has an invalid instance URL.",
    );
  }
  const host = url.hostname.toLowerCase();
  const trustedHost =
    host === "salesforce.com" || host.endsWith(".salesforce.com");
  if (
    url.protocol !== "https:" ||
    !trustedHost ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Salesforce workspace connection must use an HTTPS Salesforce instance origin.",
    );
  }
  return url.origin;
}

function actorIdForConnection(connection: WorkspaceConnectionForApp): string {
  const identityUrl = configurationValue(connection, ["salesforceIdentityUrl"]);
  if (!identityUrl) return connection.ownerEmail;
  try {
    const url = new URL(identityUrl);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    const trustedHost =
      host === "salesforce.com" || host.endsWith(".salesforce.com");
    const organizationId = configurationValue(connection, [
      "salesforceOrganizationId",
    ]);
    if (
      url.protocol === "https:" &&
      trustedHost &&
      !url.port &&
      !url.username &&
      !url.password &&
      parts[0] === "id" &&
      parts[1] &&
      parts[2] &&
      (!organizationId || organizationId === parts[1])
    ) {
      return parts[2];
    }
  } catch {
    return connection.ownerEmail;
  }
  return connection.ownerEmail;
}

function resolveApiVersion(connection: WorkspaceConnectionForApp): string {
  const value = configurationValue(connection, [
    "apiVersion",
    "salesforceApiVersion",
  ]);
  return value && /^v\d{2}\.\d$/.test(value) ? value : DEFAULT_API_VERSION;
}

function hashPermissions(fields: SalesforceField[]): string | undefined {
  const values = fields
    .map((field) => {
      const name = nonEmpty(field.name);
      return name
        ? `${name}:${field.accessible === false ? 0 : 1}:${field.createable === true ? 1 : 0}:${field.updateable === true ? 1 : 0}`
        : "";
    })
    .filter(Boolean)
    .sort();
  if (!values.length) return undefined;
  let hash = 2_166_136_261;
  for (const character of values.join("|")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `sf-fp-${(hash >>> 0).toString(36)}`;
}

function stableFingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function accessScopeFor(
  connection: WorkspaceConnectionForApp,
  objectType: string,
  fields: SalesforceField[] = [],
): CrmAccessScope {
  const grantId = connection.appAccess.grantId ?? undefined;
  const oauthConnection =
    configurationValue(connection, ["credentialMode"]) === "oauth";
  const mode =
    oauthConnection ||
    [
      ...connection.credentialRefs,
      ...(connection.explicitGrant?.credentialRefs ?? []),
    ].some((ref) => ref.scope === "user")
      ? "user"
      : "service-account";
  const configuredVisibility = configurationValue(connection, [
    "recordVisibility",
    "record_visibility",
  ]);
  const recordVisibility =
    configuredVisibility === "actor" ||
    configuredVisibility === "cohort" ||
    configuredVisibility === "workspace"
      ? configuredVisibility
      : mode === "user"
        ? "actor"
        : "unknown";
  const sharingFingerprint =
    configurationValue(connection, [
      "sharingFingerprint",
      "sharing_fingerprint",
    ]) ??
    `sf-share-${stableFingerprint(
      `${connection.id}:${grantId ?? connection.appAccess.mode}:${objectType}:${recordVisibility}`,
    )}`;
  return {
    key: `${connection.id}:${grantId ?? connection.appAccess.mode}`,
    actorId:
      mode === "user"
        ? actorIdForConnection(connection)
        : connection.ownerEmail,
    grantId,
    mode,
    objectReadable: scopeAllows(connection, objectType, "read"),
    objectCreateable: scopeAllows(connection, objectType, "write"),
    objectUpdateable: scopeAllows(connection, objectType, "write"),
    objectDeleteable: false,
    recordVisibility,
    ...(hashPermissions(fields)
      ? { fieldPermissionsHash: hashPermissions(fields) }
      : {}),
    sharingFingerprint,
  };
}

function definitionFrom(
  connection: WorkspaceConnectionForApp,
  objectType: string,
  description: SalesforceObjectDescription,
): CrmObjectDefinition {
  const fields = description.fields ?? [];
  const scope = accessScopeFor(connection, objectType, fields);
  return {
    connectionId: connection.id,
    provider: "salesforce",
    ...(connection.accountId ? { accountId: connection.accountId } : {}),
    actorId: actorIdForConnection(connection),
    objectType,
    kind: objectKind(objectType),
    label: description.label || objectType,
    pluralLabel: description.labelPlural || description.label || objectType,
    custom: description.custom === true || objectType.endsWith("__c"),
    queryable: description.queryable !== false && scope.objectReadable,
    searchable: description.searchable !== false && scope.objectReadable,
    createable: description.createable === true && scope.objectCreateable,
    updateable: description.updateable === true && scope.objectUpdateable,
    deleteable: false,
    fields: fields
      .map((field): CrmFieldDefinition | null => {
        const name = nonEmpty(field.name);
        if (!name) return null;
        const sensitive = isSensitiveField(field);
        return {
          name,
          label: field.label || name,
          valueType: fieldValueType(field),
          storagePolicy: sensitive ? "redacted" : "remote-only",
          sensitive,
          readable:
            field.accessible !== false && !sensitive && scope.objectReadable,
          createable:
            !sensitive &&
            field.createable === true &&
            field.calculated !== true &&
            scope.objectCreateable,
          updateable:
            !sensitive &&
            field.updateable === true &&
            field.calculated !== true &&
            scope.objectUpdateable,
          required:
            field.nillable === false &&
            field.defaultedOnCreate !== true &&
            field.calculated !== true,
          ...(field.picklistValues
            ? {
                options: field.picklistValues
                  .filter((option) => nonEmpty(option.value))
                  .map((option) => ({
                    value: option.value!.trim(),
                    label: option.label || option.value!.trim(),
                    ...(option.active === false ? { active: false } : {}),
                  })),
              }
            : {}),
          ...(field.referenceTo?.[0]
            ? { referencedObjectType: field.referenceTo[0] }
            : {}),
        };
      })
      .filter((field): field is CrmFieldDefinition => field !== null),
  };
}

function recordRef(
  connection: WorkspaceConnectionForApp,
  objectType: string,
  remoteId: string,
): CrmRecordRef {
  return {
    connectionId: connection.id,
    provider: "salesforce",
    ...(connection.accountId ? { accountId: connection.accountId } : {}),
    actorId: actorIdForConnection(connection),
    objectType,
    kind: objectKind(objectType),
    remoteId,
  };
}

function projectRecord(
  connection: WorkspaceConnectionForApp,
  objectType: string,
  source: SalesforceRecord,
  fields: string[],
  definition?: SalesforceObjectDescription,
): CrmRecord | null {
  const remoteId = nonEmpty(source.Id);
  if (!remoteId) return null;
  const allowed = safeFields(fields);
  const values: Record<string, CrmValue> = {};
  for (const field of allowed) {
    const value = scalarValue(source[field]);
    if (value !== undefined) values[field] = value;
  }
  const displayName =
    displayFields(objectType)
      .map((field) => values[field])
      .filter(
        (value): value is string | number | boolean =>
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean",
      )
      .map(String)
      .filter(Boolean)
      .join(" ") || remoteId;
  const remoteRevision =
    nonEmpty(source.SystemModstamp) ?? nonEmpty(source.LastModifiedDate);
  const observedAt = new Date().toISOString();
  return {
    ref: recordRef(connection, objectType, remoteId),
    displayName,
    fields: values,
    ...(remoteRevision
      ? { remoteRevision, remoteUpdatedAt: remoteRevision }
      : {}),
    deleted: source.IsDeleted === true,
    accessScope: accessScopeFor(connection, objectType, definition?.fields),
    provenance: Object.keys(values).map((fieldName) => ({
      provider: "salesforce",
      connectionId: connection.id,
      objectType,
      remoteId,
      fieldName,
      ...(remoteRevision ? { remoteRevision } : {}),
      observedAt,
    })),
  };
}

function soqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function soqlDateTime(value: string): string | undefined {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? undefined
    : new Date(timestamp).toISOString();
}

function queryPath(query: string, includeDeleted = false): string {
  return `/query${includeDeleted ? "All" : ""}?q=${encodeURIComponent(query)}`;
}

function headerValue(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const expected = name.toLowerCase();
  return Object.entries(headers).find(
    ([key]) => key.toLowerCase() === expected,
  )?.[1];
}

export function salesforceRetryDelayMs(
  response: SalesforceTransportResponse,
  attempt: number,
  elapsedMs: number,
  now = Date.now(),
): number {
  const retryAfter = headerValue(response.headers, "retry-after")?.trim();
  const numeric = retryAfter ? Number(retryAfter) : Number.NaN;
  const requested = Number.isFinite(numeric)
    ? Math.max(0, numeric * 1_000)
    : retryAfter
      ? Math.max(0, Date.parse(retryAfter) - now)
      : 100 * 2 ** attempt;
  return Math.max(
    0,
    Math.min(
      requested,
      MAX_SINGLE_RETRY_DELAY_MS,
      MAX_RETRY_DELAY_MS - elapsedMs,
    ),
  );
}

class SalesforceApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function salesforceErrorMessage(status: number): string {
  if (status === 401 || status === 403)
    return "Salesforce authentication or authorization failed.";
  if (status === 404) return "Salesforce resource was not found.";
  if (status === 429) return "Salesforce rate limit exceeded.";
  if (status >= 500) return "Salesforce service is temporarily unavailable.";
  return "Salesforce request failed.";
}

function isNotFound(error: unknown): boolean {
  return error instanceof SalesforceApiError && error.status === 404;
}

function isSafeContinuation(path: string): boolean {
  return /^\/services\/data\/v\d{2}\.\d\/query(?:All)?\/.+/.test(path);
}

function assertOwnedRecord(
  connection: WorkspaceConnectionForApp,
  record: CrmRecordRef,
): void {
  if (
    record.provider !== "salesforce" ||
    record.connectionId !== connection.id
  ) {
    throw new Error(
      "Salesforce record does not belong to this workspace connection.",
    );
  }
}

class FetchSalesforceTransport implements SalesforceTransport {
  constructor(
    private readonly instanceOrigin: string,
    private readonly apiVersion: string,
    private readonly accessToken: string,
  ) {}

  async request(
    input: SalesforceTransportRequest,
  ): Promise<SalesforceTransportResponse> {
    const path = input.path.startsWith("/services/data/")
      ? input.path
      : `/services/data/${this.apiVersion}${input.path}`;
    const response = await fetch(`${this.instanceOrigin}${path}`, {
      method: input.method ?? "GET",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(input.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...input.headers,
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
    const text = await response.text();
    let body: unknown;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return {
      status: response.status,
      body,
      headers: {
        "retry-after": response.headers.get("retry-after") ?? undefined,
      },
    };
  }
}

export class SalesforceCrmAdapter implements CrmAdapter {
  readonly connection: CrmConnectionRef;
  readonly capabilities: CrmAdapterCapabilities = {
    schemaDiscovery: true,
    customObjects: true,
    search: true,
    incrementalSync: true,
    deletedRecordSync: true,
    conditionalMutations: false,
    labeledRelationships: true,
    perFieldPermissions: true,
    perRecordPermissions: true,
  };

  private readonly descriptions = new Map<
    string,
    SalesforceObjectDescription
  >();

  constructor(private readonly options: SalesforceCrmAdapterOptions) {
    this.connection = {
      connectionId: options.connection.id,
      provider: "salesforce",
      ...(options.connection.accountId
        ? { accountId: options.connection.accountId }
        : {}),
      actorId: actorIdForConnection(options.connection),
    };
  }

  private get workspaceConnection(): WorkspaceConnectionForApp {
    return this.options.connection;
  }

  private async request<T>(input: SalesforceTransportRequest): Promise<T> {
    const readRetrySafe =
      input.retrySafe === true ||
      input.method === undefined ||
      input.method === "GET";
    let elapsedDelayMs = 0;
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      const response = await this.options.transport.request(input);
      if (response.status >= 200 && response.status < 300) {
        return (response.body ?? {}) as T;
      }
      const retryable =
        attempt + 1 < MAX_RETRY_ATTEMPTS &&
        readRetrySafe &&
        (response.status === 429 || response.status >= 500) &&
        elapsedDelayMs < MAX_RETRY_DELAY_MS;
      if (!retryable) {
        throw new SalesforceApiError(
          response.status,
          `Salesforce API error ${response.status}: ${salesforceErrorMessage(response.status)}`,
        );
      }
      const delay = salesforceRetryDelayMs(response, attempt, elapsedDelayMs);
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        elapsedDelayMs += delay;
      }
    }
    throw new Error("Salesforce retry budget was exhausted.");
  }

  private async describe(
    objectType: string,
  ): Promise<SalesforceObjectDescription> {
    const normalized = assertSafeObjectType(objectType);
    const cached = this.descriptions.get(normalized);
    if (cached) return cached;
    const description = await this.request<SalesforceObjectDescription>({
      path: `/sobjects/${encodeURIComponent(normalized)}/describe`,
    });
    this.descriptions.set(normalized, description);
    return description;
  }

  async discoverObjects(): Promise<CrmObjectDefinition[]> {
    const global = await this.request<{ sobjects?: SalesforceGlobalObject[] }>({
      path: "/sobjects/",
    });
    const types = uniqueStrings([
      ...CORE_OBJECT_TYPES,
      ...(global.sobjects ?? [])
        .filter((object) => object.queryable !== false)
        .map((object) => object.name ?? ""),
    ])
      .filter((type) => SAFE_OBJECT_NAME.test(type))
      .slice(0, MAX_DISCOVERED_OBJECTS);
    const definitions: CrmObjectDefinition[] = [];
    for (let index = 0; index < types.length; index += DISCOVERY_CONCURRENCY) {
      definitions.push(
        ...(await Promise.all(
          types
            .slice(index, index + DISCOVERY_CONCURRENCY)
            .map((type) => this.describeObject(type)),
        )),
      );
    }
    return definitions;
  }

  async describeObject(objectType: string): Promise<CrmObjectDefinition> {
    const normalized = assertSafeObjectType(objectType);
    const description = await this.describe(normalized);
    return definitionFrom(this.workspaceConnection, normalized, description);
  }

  async getAccessScope(objectType: string): Promise<CrmAccessScope> {
    const normalized = assertSafeObjectType(objectType);
    const description = await this.describe(normalized);
    return accessScopeFor(
      this.workspaceConnection,
      normalized,
      description?.fields,
    );
  }

  private async query(path: string): Promise<SalesforceQueryResponse> {
    return this.request<SalesforceQueryResponse>({ path });
  }

  private selectFields(fields: string[]): string[] {
    return uniqueStrings([
      "Id",
      "SystemModstamp",
      "LastModifiedDate",
      "IsDeleted",
      ...safeFields(fields),
    ]);
  }

  private scopeWhere(input: {
    objectType: string;
    pipelineIds?: string[];
    ownerIds?: string[];
    updatedAfter?: string;
  }): string[] {
    const filters: string[] = [];
    if (input.objectType === "Opportunity" && input.pipelineIds?.length) {
      const ids = uniqueStrings(input.pipelineIds).map(soqlString);
      if (ids.length) filters.push(`RecordTypeId IN (${ids.join(",")})`);
    }
    if (input.ownerIds?.length) {
      const ids = uniqueStrings(input.ownerIds).map(soqlString);
      if (ids.length) filters.push(`OwnerId IN (${ids.join(",")})`);
    }
    const updatedAfter = input.updatedAfter
      ? soqlDateTime(input.updatedAfter)
      : undefined;
    if (updatedAfter) filters.push(`SystemModstamp >= ${updatedAfter}`);
    return filters;
  }

  async syncPage(
    input: Parameters<CrmAdapter["syncPage"]>[0],
  ): Promise<CrmSyncPage> {
    const objectType = assertSafeObjectType(input.scope.objectType);
    if (input.scope.associatedRecordIds?.length) {
      throw new Error(
        "Salesforce associated-record cohorts are not enabled; scope the sync with recordIds, ownerIds, or Opportunity record-type IDs.",
      );
    }
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, input.limit));
    const fields = safeFields(input.fieldAllowList);
    const description = await this.describe(objectType);
    const recordIds = uniqueStrings(input.scope.recordIds ?? []);
    const cursor = decodeCursor<{ index?: number; next?: string }>(
      input.cursor,
    );
    let page: SalesforceQueryResponse;
    let nextCursor: string | undefined;
    if (cursor?.next && isSafeContinuation(cursor.next)) {
      page = await this.query(cursor.next);
      nextCursor =
        page.nextRecordsUrl && isSafeContinuation(page.nextRecordsUrl)
          ? encodedCursor({ next: page.nextRecordsUrl })
          : undefined;
    } else if (recordIds.length) {
      const index = Math.max(0, Math.min(cursor?.index ?? 0, recordIds.length));
      const ids = recordIds.slice(index, index + limit).map(soqlString);
      if (!ids.length)
        return { records: [], relationships: [], complete: true };
      page = await this.query(
        queryPath(
          `SELECT ${this.selectFields(fields).join(",")} FROM ${objectType} WHERE Id IN (${ids.join(",")}) LIMIT ${limit}`,
          input.scope.includeDeleted,
        ),
      );
      const offset = index + limit;
      nextCursor =
        offset < recordIds.length
          ? encodedCursor({ index: offset })
          : undefined;
    } else {
      const where = this.scopeWhere({ ...input.scope, objectType });
      page = await this.query(
        queryPath(
          `SELECT ${this.selectFields(fields).join(",")} FROM ${objectType}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY SystemModstamp ASC, Id ASC LIMIT ${limit}`,
          input.scope.includeDeleted,
        ),
      );
      nextCursor =
        page.nextRecordsUrl && isSafeContinuation(page.nextRecordsUrl)
          ? encodedCursor({ next: page.nextRecordsUrl })
          : undefined;
    }
    const records = (page.records ?? [])
      .map((record) =>
        projectRecord(
          this.workspaceConnection,
          objectType,
          record,
          fields,
          description,
        ),
      )
      .filter((record): record is CrmRecord => record !== null);
    return {
      records,
      relationships: [],
      ...(nextCursor ? { nextCursor } : {}),
      complete: !nextCursor,
    };
  }

  async getRecord(
    input: Parameters<CrmAdapter["getRecord"]>[0],
  ): Promise<CrmRecord | null> {
    assertOwnedRecord(this.workspaceConnection, input.record);
    const objectType = assertSafeObjectType(input.record.objectType);
    const description = await this.describe(objectType);
    const fields = safeFields(input.fields);
    try {
      const record = await this.request<SalesforceRecord>({
        path: `/sobjects/${encodeURIComponent(objectType)}/${encodeURIComponent(input.record.remoteId)}?fields=${encodeURIComponent(this.selectFields(fields).join(","))}`,
      });
      return projectRecord(
        this.workspaceConnection,
        objectType,
        record,
        fields,
        description,
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async search(
    input: Parameters<CrmAdapter["search"]>[0],
  ): Promise<CrmSyncPage> {
    const objectTypes = uniqueStrings(input.objectTypes).filter((type) =>
      SAFE_OBJECT_NAME.test(type),
    );
    if (!objectTypes.length)
      return { records: [], relationships: [], complete: true };
    const state = decodeCursor<{ index?: number; next?: string }>(input.cursor);
    const index = Math.max(
      0,
      Math.min(state?.index ?? 0, objectTypes.length - 1),
    );
    const objectType = objectTypes[index]!;
    const fields = safeFields(input.fields);
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, input.limit));
    const description = await this.describe(objectType);
    const page =
      state?.next && isSafeContinuation(state.next)
        ? await this.query(state.next)
        : await this.query(
            queryPath(
              `SELECT ${this.selectFields(fields).join(",")} FROM ${objectType} WHERE ${searchField(objectType)} LIKE ${soqlString(`%${input.query.trim()}%`)} ORDER BY SystemModstamp DESC, Id ASC LIMIT ${limit}`,
            ),
          );
    const records = (page.records ?? [])
      .map((record) =>
        projectRecord(
          this.workspaceConnection,
          objectType,
          record,
          fields,
          description,
        ),
      )
      .filter((record): record is CrmRecord => record !== null);
    const nextCursor =
      page.nextRecordsUrl && isSafeContinuation(page.nextRecordsUrl)
        ? encodedCursor({ index, next: page.nextRecordsUrl })
        : index + 1 < objectTypes.length
          ? encodedCursor({ index: index + 1 })
          : undefined;
    return {
      records,
      relationships: [],
      ...(nextCursor ? { nextCursor } : {}),
      complete: !nextCursor,
    };
  }

  async listRelationships(
    input: Parameters<CrmAdapter["listRelationships"]>[0],
  ): Promise<{
    relationships: CrmRelationship[];
    nextCursor?: string;
    complete: boolean;
  }> {
    assertOwnedRecord(this.workspaceConnection, input.record);
    const objectType = assertSafeObjectType(input.record.objectType);
    const description = await this.describe(objectType);
    const targets = new Set(uniqueStrings(input.targetObjectTypes ?? []));
    const state = decodeCursor<{ index?: number }>(input.cursor);
    const fields = (description.fields ?? []).filter(
      (field) =>
        field.type === "reference" &&
        field.accessible !== false &&
        field.name &&
        (!targets.size ||
          field.referenceTo?.some((target) => targets.has(target))),
    );
    const start = Math.max(0, Math.min(state?.index ?? 0, fields.length));
    const boundedFields = fields.slice(
      start,
      start + Math.max(1, Math.min(MAX_PAGE_SIZE, input.limit)),
    );
    if (!boundedFields.length) return { relationships: [], complete: true };
    const record = await this.request<SalesforceRecord>({
      path: `/sobjects/${encodeURIComponent(objectType)}/${encodeURIComponent(input.record.remoteId)}?fields=${encodeURIComponent(["Id", ...boundedFields.map((field) => field.name!)].join(","))}`,
    });
    const relationships = boundedFields.flatMap((field): CrmRelationship[] => {
      const remoteId = scalarValue(record[field.name!]);
      const target = field.referenceTo?.[0];
      if (typeof remoteId !== "string" || !target) return [];
      return [
        {
          from: input.record,
          to: recordRef(this.workspaceConnection, target, remoteId),
          relationshipType: field.name!,
          ...(field.label ? { label: field.label } : {}),
        },
      ];
    });
    const nextCursor =
      start + boundedFields.length < fields.length
        ? encodedCursor({ index: start + boundedFields.length })
        : undefined;
    return {
      relationships,
      ...(nextCursor ? { nextCursor } : {}),
      complete: !nextCursor,
    };
  }

  async applyMutation(mutation: Parameters<CrmAdapter["applyMutation"]>[0]) {
    assertOwnedRecord(this.workspaceConnection, mutation.record);
    if (!mutation.idempotencyKey.trim()) {
      return {
        status: "rejected" as const,
        message: "An idempotency key is required.",
      };
    }
    if (mutation.operation === "delete") {
      return {
        status: "rejected" as const,
        message:
          "Salesforce deletion is disabled during the initial CRM transport rollout.",
      };
    }
    if (
      mutation.operation === "associate" ||
      mutation.operation === "disassociate"
    ) {
      return {
        status: "rejected" as const,
        message:
          "Salesforce association mutation requires an explicit relationship definition and is not enabled in the initial rollout.",
      };
    }
    if (
      !scopeAllows(
        this.workspaceConnection,
        mutation.record.objectType,
        "write",
      )
    ) {
      return {
        status: "rejected" as const,
        message:
          "The workspace connection does not prove write access for this Salesforce object.",
      };
    }
    if (mutation.operation === "create") {
      return {
        status: "rejected" as const,
        message:
          "Salesforce creation is disabled because this adapter cannot guarantee an atomic idempotent create.",
      };
    }
    if (!mutation.expectedRemoteRevision) {
      return {
        status: "rejected" as const,
        message: "Salesforce mutations require a current remote revision.",
      };
    }
    const current = await this.getRecord({
      record: mutation.record,
      fields: [],
    });
    if (
      !current ||
      current.remoteRevision !== mutation.expectedRemoteRevision
    ) {
      return {
        status: "conflict" as const,
        ...(current?.remoteRevision
          ? { remoteRevision: current.remoteRevision }
          : {}),
        message:
          "The Salesforce record changed before this mutation could be applied.",
      };
    }
    return {
      status: "rejected" as const,
      remoteRevision: current.remoteRevision,
      message:
        "Salesforce does not support an atomic conditional update through this CRM adapter.",
    };
  }
}

function requireResolvedConnection(
  result: ResolvedWorkspaceConnectionForApp,
): WorkspaceConnectionForApp {
  if (!result.available || !result.connection) {
    throw new Error(
      `Salesforce workspace connection is unavailable: ${result.reason}`,
    );
  }
  return result.connection;
}

export async function createSalesforceCrmAdapter(
  options: CreateSalesforceCrmAdapterOptions = {},
): Promise<SalesforceCrmAdapter> {
  const resolved = await resolveWorkspaceConnectionForApp({
    appId: CRM_APP_ID,
    provider: "salesforce",
    ...(options.connectionId ? { connectionId: options.connectionId } : {}),
    requireConnected: true,
  });
  const connection = requireResolvedConnection(resolved);
  if (options.transport) {
    return new SalesforceCrmAdapter({
      connection,
      transport: options.transport,
    });
  }
  const instanceUrl = resolveInstanceUrl(connection);
  try {
    const oauth = await resolveProviderApiOAuthAccessToken(
      { provider: "salesforce", connectionId: connection.id },
      { appId: CRM_APP_ID, providerIds: ["salesforce"] },
    );
    if (oauth.connectionId === connection.id && oauth.accessToken) {
      return new SalesforceCrmAdapter({
        connection,
        transport: new FetchSalesforceTransport(
          instanceUrl,
          resolveApiVersion(connection),
          oauth.accessToken,
        ),
      });
    }
  } catch {
    // Manual bearer credentials remain supported for non-OAuth connections.
  }
  for (const key of SALESFORCE_CREDENTIAL_KEYS) {
    const credential = await resolveWorkspaceConnectionCredentialForApp({
      appId: CRM_APP_ID,
      provider: "salesforce",
      key,
      connectionId: connection.id,
      ...(options.userEmail ? { userEmail: options.userEmail } : {}),
      ...(options.orgId !== undefined ? { orgId: options.orgId } : {}),
    });
    if (!credential.available || !credential.value) continue;
    if (credential.provenance?.connectionId !== connection.id) continue;
    return new SalesforceCrmAdapter({
      connection,
      transport: new FetchSalesforceTransport(
        instanceUrl,
        resolveApiVersion(connection),
        credential.value,
      ),
    });
  }
  throw new Error(
    "Salesforce workspace connection is unavailable: no scoped credential was resolved for the granted connection.",
  );
}
