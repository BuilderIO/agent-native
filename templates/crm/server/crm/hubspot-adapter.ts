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
  CrmObjectRef,
  CrmProvenance,
  CrmRecord,
  CrmRecordRef,
  CrmRelationship,
  CrmSyncPage,
  CrmValue,
} from "../../shared/crm-contract.js";

const HUBSPOT_API_BASE = "https://api.hubapi.com";
const CRM_APP_ID = "crm";
const HUBSPOT_CREDENTIAL_KEYS = [
  "HUBSPOT_ACCESS_TOKEN",
  "HUBSPOT_PRIVATE_APP_TOKEN",
] as const;
const CORE_OBJECT_TYPES = ["companies", "contacts", "deals"] as const;
const MAX_PAGE_SIZE = 100;
const MAX_RETRY_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 1_500;
const MAX_SINGLE_RETRY_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 10_000;

type HubSpotObjectType = (typeof CORE_OBJECT_TYPES)[number] | string;

export interface HubSpotTransportRequest {
  path: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  retrySafe?: boolean;
}

export interface HubSpotTransportResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string | undefined>;
}

export interface HubSpotTransport {
  request(input: HubSpotTransportRequest): Promise<HubSpotTransportResponse>;
}

export interface CreateHubSpotCrmAdapterOptions {
  connectionId?: string;
  userEmail?: string;
  orgId?: string | null;
  transport?: HubSpotTransport;
}

export interface HubSpotCrmAdapterOptions {
  connection: WorkspaceConnectionForApp;
  transport: HubSpotTransport;
  accessScope?: CrmAccessScope;
}

type HubSpotProperty = {
  name?: string;
  label?: string;
  type?: string;
  fieldType?: string;
  hidden?: boolean;
  readOnlyValue?: boolean;
  calculated?: boolean;
  required?: boolean;
  options?: Array<{ value?: string; label?: string; hidden?: boolean }>;
  referencedObjectType?: string;
  sensitiveDataCategory?: string;
};

type HubSpotSchema = {
  objectTypeId?: string | number;
  name?: string;
  labels?: { singular?: string; plural?: string };
  metaType?: string;
  properties?: HubSpotProperty[];
};

type HubSpotRecord = {
  id?: string | number;
  properties?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
};

type HubSpotListResponse = {
  results?: HubSpotRecord[];
  paging?: { next?: { after?: string } };
};

type HubSpotAssociation = {
  toObjectId?: string | number;
  id?: string | number;
  associationTypes?: Array<{
    associationCategory?: string;
    associationTypeId?: string | number;
    label?: string | null;
  }>;
};

type HubSpotAssociationResponse = {
  results?: HubSpotAssociation[];
  paging?: { next?: { after?: string } };
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

function objectKind(objectType: string): CrmObjectKind {
  switch (objectType.toLowerCase()) {
    case "companies":
      return "account";
    case "contacts":
      return "person";
    case "deals":
      return "opportunity";
    case "tasks":
      return "task";
    case "calls":
    case "emails":
    case "meetings":
    case "notes":
      return "activity";
    default:
      return "custom";
  }
}

function objectDisplayProperty(objectType: string): string[] {
  switch (objectType.toLowerCase()) {
    case "companies":
      return ["name", "domain"];
    case "contacts":
      return ["firstname", "lastname", "email"];
    case "deals":
      return ["dealname"];
    case "tickets":
      return ["subject"];
    default:
      return ["name", "hs_object_id"];
  }
}

function propertyValueType(
  property: HubSpotProperty,
): CrmFieldDefinition["valueType"] {
  const type = property.type?.toLowerCase();
  const fieldType = property.fieldType?.toLowerCase();
  if (fieldType === "checkbox") return "multi-enum";
  if (type === "enumeration") return "enum";
  if (type === "bool" || type === "boolean") return "boolean";
  if (type === "number") return "number";
  if (type === "date") return "date";
  if (type === "datetime") return "datetime";
  if (type === "json") return "json";
  if (fieldType === "currency" || property.name === "amount") return "currency";
  if (fieldType === "percentage") return "percent";
  if (type === "object_coordinates" || type === "reference") return "reference";
  return "string";
}

function propertyIsSensitive(property: HubSpotProperty): boolean {
  const category = property.sensitiveDataCategory?.trim().toLowerCase();
  return Boolean(
    category && category !== "none" && category !== "not_sensitive",
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
    const values = value.filter(
      (item): item is string | number | boolean | null =>
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    );
    return values.length === value.length ? values : undefined;
  }
  return undefined;
}

function toQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const value = query.toString();
  return value ? `?${value}` : "";
}

function encodeCursorState(value: { index: number; after?: string }): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodedCursor(cursor: string | undefined): {
  index: number;
  after?: string;
} {
  if (!cursor) return { index: 0 };
  try {
    const padded = cursor
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(cursor.length / 4) * 4, "=");
    const binary = atob(padded);
    const decoded = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(binary, (character) => character.charCodeAt(0)),
      ),
    ) as { index?: unknown; after?: unknown };
    const index = typeof decoded.index === "number" ? decoded.index : 0;
    return {
      index: Number.isInteger(index) && index >= 0 ? index : 0,
      ...(typeof decoded.after === "string" && decoded.after
        ? { after: decoded.after }
        : {}),
    };
  } catch {
    // HubSpot's `after` values are already opaque; accept them for one-object callers.
    return { index: 0, after: cursor };
  }
}

function encodedCursor(index: number, after?: string): string | undefined {
  if (!after) return undefined;
  return encodeCursorState({ index, after });
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
  const singular = objectType.toLowerCase().replace(/s$/, "");
  return scopes.some(
    (scope) =>
      scope === "all" ||
      scope === "crm" ||
      scope === `crm.${operation}` ||
      scope === `crm.objects.${operation}` ||
      scope === `crm.objects.${objectType.toLowerCase()}.${operation}` ||
      scope === `crm.objects.${singular}.${operation}` ||
      (operation === "write" && scope.endsWith(".write")),
  );
}

function accessScopeFor(
  connection: WorkspaceConnectionForApp,
  objectType: string,
): CrmAccessScope {
  const grantId = connection.appAccess.grantId ?? undefined;
  const mode = [
    ...connection.credentialRefs,
    ...(connection.explicitGrant?.credentialRefs ?? []),
  ].some((ref) => ref.scope === "user")
    ? "user"
    : "service-account";
  const readable = scopeAllows(connection, objectType, "read");
  const writable = scopeAllows(connection, objectType, "write");
  return {
    key: `${connection.id}:${grantId ?? connection.appAccess.mode}`,
    actorId: connection.ownerEmail,
    grantId,
    mode,
    objectReadable: readable,
    objectCreateable: writable,
    objectUpdateable: writable,
    objectDeleteable: false,
    recordVisibility: mode === "user" ? "actor" : "unknown",
  };
}

function definitionFrom(
  connection: WorkspaceConnectionForApp,
  objectType: string,
  schema: HubSpotSchema | undefined,
  properties: HubSpotProperty[],
): CrmObjectDefinition {
  const scope = accessScopeFor(connection, objectType);
  const custom =
    !CORE_OBJECT_TYPES.includes(
      objectType as (typeof CORE_OBJECT_TYPES)[number],
    ) && schema?.metaType !== "HUBSPOT";
  return {
    connectionId: connection.id,
    provider: "hubspot",
    ...(connection.accountId ? { accountId: connection.accountId } : {}),
    actorId: connection.ownerEmail,
    objectType,
    kind: objectKind(objectType),
    label: schema?.labels?.singular || objectType,
    pluralLabel: schema?.labels?.plural || objectType,
    custom,
    queryable: scope.objectReadable,
    searchable: scope.objectReadable,
    createable: scope.objectCreateable,
    updateable: scope.objectUpdateable,
    deleteable: false,
    fields: properties
      .map((property): CrmFieldDefinition | null => {
        const name = nonEmpty(property.name);
        if (!name) return null;
        const sensitive = propertyIsSensitive(property);
        return {
          name,
          label: property.label || name,
          valueType: propertyValueType(property),
          storagePolicy: sensitive ? "redacted" : "remote-only",
          sensitive,
          readable: !property.hidden && scope.objectReadable,
          createable:
            !sensitive &&
            !property.readOnlyValue &&
            !property.calculated &&
            scope.objectCreateable,
          updateable:
            !sensitive &&
            !property.readOnlyValue &&
            !property.calculated &&
            scope.objectUpdateable,
          required: property.required === true,
          ...(property.options
            ? {
                options: property.options
                  .filter((option) => nonEmpty(option.value))
                  .map((option) => ({
                    value: option.value!.trim(),
                    label: option.label || option.value!.trim(),
                    ...(option.hidden ? { active: false } : {}),
                  })),
              }
            : {}),
          ...(property.referencedObjectType
            ? { referencedObjectType: property.referencedObjectType }
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
    provider: "hubspot",
    ...(connection.accountId ? { accountId: connection.accountId } : {}),
    actorId: connection.ownerEmail,
    objectType,
    kind: objectKind(objectType),
    remoteId,
  };
}

function provenance(
  connection: WorkspaceConnectionForApp,
  objectType: string,
  remoteId: string,
  remoteRevision: string | undefined,
  fieldNames: string[],
): CrmProvenance[] {
  const observedAt = new Date().toISOString();
  return fieldNames.map((fieldName) => ({
    provider: "hubspot",
    connectionId: connection.id,
    objectType,
    remoteId,
    fieldName,
    ...(remoteRevision ? { remoteRevision } : {}),
    observedAt,
  }));
}

function projectRecord(
  connection: WorkspaceConnectionForApp,
  objectType: string,
  source: HubSpotRecord,
  fieldAllowList: string[],
): CrmRecord | null {
  const remoteId = source.id == null ? undefined : String(source.id);
  if (!remoteId) return null;
  const allowed = uniqueStrings(fieldAllowList);
  const fields: Record<string, CrmValue> = {};
  for (const fieldName of allowed) {
    const value = scalarValue(source.properties?.[fieldName]);
    if (value !== undefined) fields[fieldName] = value;
  }
  const displayValues = objectDisplayProperty(objectType)
    .map((fieldName) => fields[fieldName])
    .filter((value): value is CrmValue => value !== undefined)
    .filter(
      (value): value is string | number | boolean =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean",
    );
  const displayName =
    displayValues.map(String).filter(Boolean).join(" ") || remoteId;
  const remoteRevision = source.updatedAt;
  return {
    ref: recordRef(connection, objectType, remoteId),
    displayName,
    fields,
    ...(remoteRevision ? { remoteRevision } : {}),
    ...(source.updatedAt ? { remoteUpdatedAt: source.updatedAt } : {}),
    deleted: source.archived === true,
    accessScope: accessScopeFor(connection, objectType),
    provenance: provenance(
      connection,
      objectType,
      remoteId,
      remoteRevision,
      Object.keys(fields),
    ),
  };
}

function isNotFound(error: unknown): boolean {
  return error instanceof HubSpotApiError && error.status === 404;
}

class HubSpotApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function hubSpotErrorMessage(status: number): string {
  if (status === 401 || status === 403)
    return "HubSpot authentication or authorization failed.";
  if (status === 404) return "HubSpot resource was not found.";
  if (status === 429) return "HubSpot rate limit exceeded.";
  if (status >= 500) return "HubSpot service is temporarily unavailable.";
  return "HubSpot request failed.";
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

export function hubSpotRetryDelayMs(
  response: HubSpotTransportResponse,
  attempt: number,
  elapsedMs: number,
  now = Date.now(),
): number {
  const retryAfter = headerValue(response.headers, "retry-after")?.trim();
  const numericRetryAfter = retryAfter ? Number(retryAfter) : Number.NaN;
  const requestedDelay = Number.isFinite(numericRetryAfter)
    ? Math.max(0, numericRetryAfter * 1_000)
    : retryAfter
      ? Math.max(0, Date.parse(retryAfter) - now)
      : 100 * 2 ** attempt;
  return Math.max(
    0,
    Math.min(
      requestedDelay,
      MAX_SINGLE_RETRY_DELAY_MS,
      MAX_RETRY_DELAY_MS - elapsedMs,
    ),
  );
}

function canRetryHubSpotResponse(status: number): boolean {
  return status === 429 || status >= 500;
}

function assertOwnedRecord(
  connection: WorkspaceConnectionForApp,
  record: CrmRecordRef,
): void {
  if (record.provider !== "hubspot" || record.connectionId !== connection.id) {
    throw new Error(
      "HubSpot record does not belong to this workspace connection.",
    );
  }
}

class FetchHubSpotTransport implements HubSpotTransport {
  constructor(private readonly token: string) {}

  async request(
    input: HubSpotTransportRequest,
  ): Promise<HubSpotTransportResponse> {
    const response = await fetch(`${HUBSPOT_API_BASE}${input.path}`, {
      method: input.method ?? "GET",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.token}`,
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

export class HubSpotCrmAdapter implements CrmAdapter {
  readonly connection: CrmConnectionRef;
  readonly capabilities: CrmAdapterCapabilities = {
    schemaDiscovery: true,
    customObjects: true,
    search: true,
    incrementalSync: true,
    deletedRecordSync: true,
    conditionalMutations: false,
    labeledRelationships: true,
    perFieldPermissions: false,
    perRecordPermissions: false,
  };

  private readonly workspaceConnection: WorkspaceConnectionForApp;
  private readonly transport: HubSpotTransport;

  constructor(options: HubSpotCrmAdapterOptions) {
    this.workspaceConnection = options.connection;
    this.transport = options.transport;
    this.connection = {
      connectionId: options.connection.id,
      provider: "hubspot",
      ...(options.connection.accountId
        ? { accountId: options.connection.accountId }
        : {}),
      actorId: options.connection.ownerEmail,
    };
  }

  private async request<T>(input: HubSpotTransportRequest): Promise<T> {
    const readRetrySafe =
      input.retrySafe === true ||
      input.method === undefined ||
      input.method === "GET";
    let elapsedDelayMs = 0;
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      const response = await this.transport.request(input);
      if (response.status >= 200 && response.status < 300) {
        return (response.body ?? {}) as T;
      }
      const mayRetry =
        attempt + 1 < MAX_RETRY_ATTEMPTS &&
        readRetrySafe &&
        canRetryHubSpotResponse(response.status) &&
        elapsedDelayMs < MAX_RETRY_DELAY_MS;
      if (!mayRetry) {
        throw new HubSpotApiError(
          response.status,
          `HubSpot API error ${response.status}: ${hubSpotErrorMessage(response.status)}`,
        );
      }
      const delay = hubSpotRetryDelayMs(response, attempt, elapsedDelayMs);
      if (delay <= 0) {
        continue;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      elapsedDelayMs += delay;
    }
    throw new Error("HubSpot retry budget was exhausted.");
  }

  private async schema(objectType: string): Promise<HubSpotSchema | undefined> {
    try {
      return await this.request<HubSpotSchema>({
        path: `/crm/v3/schemas/${encodeURIComponent(objectType)}`,
      });
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  private async properties(objectType: string): Promise<HubSpotProperty[]> {
    const response = await this.request<{ results?: HubSpotProperty[] }>({
      path: `/crm/v3/properties/${encodeURIComponent(objectType)}`,
    });
    return response.results ?? [];
  }

  private async objectDefinition(
    objectType: string,
  ): Promise<CrmObjectDefinition> {
    const [schema, properties] = await Promise.all([
      this.schema(objectType),
      this.properties(objectType),
    ]);
    return definitionFrom(
      this.workspaceConnection,
      objectType,
      schema,
      properties,
    );
  }

  async discoverObjects(): Promise<CrmObjectDefinition[]> {
    const schemas = await this.request<{ results?: HubSpotSchema[] }>({
      path: "/crm/v3/schemas",
    });
    const objectTypes = uniqueStrings([
      ...CORE_OBJECT_TYPES,
      ...(schemas.results ?? []).map(
        (schema) =>
          nonEmpty(schema.name) ??
          (schema.objectTypeId == null ? "" : String(schema.objectTypeId)),
      ),
    ]);
    return Promise.all(
      objectTypes.map((objectType) => this.objectDefinition(objectType)),
    );
  }

  async describeObject(objectType: string): Promise<CrmObjectDefinition> {
    const normalized = nonEmpty(objectType);
    if (!normalized) throw new Error("HubSpot objectType is required.");
    return this.objectDefinition(normalized);
  }

  getAccessScope(objectType: string): CrmAccessScope {
    const normalized = nonEmpty(objectType);
    if (!normalized) throw new Error("HubSpot objectType is required.");
    return accessScopeFor(this.workspaceConnection, normalized);
  }

  private async listPage(input: {
    objectType: HubSpotObjectType;
    fields: string[];
    limit: number;
    cursor?: string;
    archived?: boolean;
    filterGroups?: unknown[];
  }): Promise<HubSpotListResponse> {
    const objectType = encodeURIComponent(input.objectType);
    if (input.filterGroups?.length) {
      return this.request<HubSpotListResponse>({
        method: "POST",
        retrySafe: true,
        path: `/crm/v3/objects/${objectType}/search`,
        body: {
          limit: input.limit,
          ...(input.cursor ? { after: input.cursor } : {}),
          ...(input.fields.length ? { properties: input.fields } : {}),
          filterGroups: input.filterGroups,
        },
      });
    }
    return this.request<HubSpotListResponse>({
      path: `/crm/v3/objects/${objectType}${toQuery({
        limit: String(input.limit),
        ...(input.cursor ? { after: input.cursor } : {}),
        ...(input.fields.length ? { properties: input.fields.join(",") } : {}),
        ...(input.archived ? { archived: "true" } : {}),
      })}`,
    });
  }

  private filtersForScope(scope: {
    objectType: string;
    pipelineIds?: string[];
    ownerIds?: string[];
    updatedAfter?: string;
  }): unknown[] {
    const filters: Array<Record<string, unknown>> = [];
    if (
      scope.objectType.toLowerCase() === "deals" &&
      scope.pipelineIds?.length
    ) {
      filters.push({
        propertyName: "pipeline",
        operator: "IN",
        values: uniqueStrings(scope.pipelineIds),
      });
    }
    if (scope.ownerIds?.length) {
      filters.push({
        propertyName: "hubspot_owner_id",
        operator: "IN",
        values: uniqueStrings(scope.ownerIds),
      });
    }
    if (scope.updatedAfter) {
      filters.push({
        propertyName: "hs_lastmodifieddate",
        operator: "GTE",
        value: scope.updatedAfter,
      });
    }
    return filters.length ? [{ filters }] : [];
  }

  async syncPage(input: {
    scope: {
      objectType: string;
      pipelineIds?: string[];
      ownerIds?: string[];
      recordIds?: string[];
      associatedRecordIds?: string[];
      updatedAfter?: string;
      includeDeleted?: boolean;
    };
    fieldAllowList: string[];
    cursor?: string;
    limit: number;
  }): Promise<CrmSyncPage> {
    const objectType = nonEmpty(input.scope.objectType);
    if (!objectType)
      throw new Error("HubSpot sync scope objectType is required.");
    const fields = uniqueStrings(input.fieldAllowList);
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, input.limit));
    const recordIds = uniqueStrings(input.scope.recordIds ?? []);
    let page: HubSpotListResponse;
    if (recordIds.length) {
      const state = decodedCursor(input.cursor);
      const offset = Math.min(state.index, recordIds.length);
      page = await this.request<HubSpotListResponse>({
        method: "POST",
        retrySafe: true,
        path: `/crm/v3/objects/${encodeURIComponent(objectType)}/batch/read`,
        body: {
          inputs: recordIds.slice(offset, offset + limit).map((id) => ({ id })),
          ...(fields.length ? { properties: fields } : {}),
          ...(input.scope.includeDeleted ? { archived: true } : {}),
        },
      });
    } else {
      page = await this.listPage({
        objectType,
        fields,
        limit,
        cursor: input.cursor,
        archived: input.scope.includeDeleted,
        filterGroups: this.filtersForScope(input.scope),
      });
    }
    const associatedIds = new Set(
      uniqueStrings(input.scope.associatedRecordIds ?? []),
    );
    const records = (page.results ?? [])
      .filter(
        (record) => !associatedIds.size || associatedIds.has(String(record.id)),
      )
      .map((record) =>
        projectRecord(this.workspaceConnection, objectType, record, fields),
      )
      .filter((record): record is CrmRecord => record !== null);
    const nextCursor = recordIds.length
      ? (() => {
          const offset = decodedCursor(input.cursor).index + limit;
          return offset < recordIds.length
            ? encodeCursorState({ index: offset })
            : undefined;
        })()
      : page.paging?.next?.after;
    return {
      records,
      relationships: [],
      ...(nextCursor ? { nextCursor } : {}),
      complete: !nextCursor,
    };
  }

  async getRecord(input: {
    record: CrmRecordRef;
    fields: string[];
  }): Promise<CrmRecord | null> {
    assertOwnedRecord(this.workspaceConnection, input.record);
    const fields = uniqueStrings(input.fields);
    try {
      const record = await this.request<HubSpotRecord>({
        path: `/crm/v3/objects/${encodeURIComponent(input.record.objectType)}/${encodeURIComponent(input.record.remoteId)}${toQuery(
          {
            ...(fields.length ? { properties: fields.join(",") } : {}),
          },
        )}`,
      });
      return projectRecord(
        this.workspaceConnection,
        input.record.objectType,
        record,
        fields,
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async search(input: {
    objectTypes: string[];
    query: string;
    fields: string[];
    limit: number;
    cursor?: string;
  }): Promise<CrmSyncPage> {
    const objectTypes = uniqueStrings(input.objectTypes);
    if (!objectTypes.length)
      return { records: [], relationships: [], complete: true };
    const fields = uniqueStrings(input.fields);
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, input.limit));
    const state = decodedCursor(input.cursor);
    const index = Math.min(state.index, objectTypes.length - 1);
    const objectType = objectTypes[index]!;
    const page = await this.request<HubSpotListResponse>({
      method: "POST",
      path: `/crm/v3/objects/${encodeURIComponent(objectType)}/search`,
      body: {
        query: input.query,
        limit,
        ...(state.after ? { after: state.after } : {}),
        ...(fields.length ? { properties: fields } : {}),
      },
    });
    const records = (page.results ?? [])
      .map((record) =>
        projectRecord(this.workspaceConnection, objectType, record, fields),
      )
      .filter((record): record is CrmRecord => record !== null);
    const after = page.paging?.next?.after;
    const nextCursor = after
      ? encodedCursor(index, after)
      : index + 1 < objectTypes.length
        ? encodeCursorState({ index: index + 1 })
        : undefined;
    return {
      records,
      relationships: [],
      ...(nextCursor ? { nextCursor } : {}),
      complete: !nextCursor,
    };
  }

  async listRelationships(input: {
    record: CrmRecordRef;
    targetObjectTypes?: string[];
    limit: number;
    cursor?: string;
  }): Promise<{
    relationships: CrmRelationship[];
    nextCursor?: string;
    complete: boolean;
  }> {
    assertOwnedRecord(this.workspaceConnection, input.record);
    const targetObjectTypes = uniqueStrings(
      input.targetObjectTypes?.length
        ? input.targetObjectTypes
        : CORE_OBJECT_TYPES,
    ).filter((objectType) => objectType !== input.record.objectType);
    if (!targetObjectTypes.length) {
      return { relationships: [], complete: true };
    }
    const state = decodedCursor(input.cursor);
    const index = Math.min(state.index, targetObjectTypes.length - 1);
    const targetObjectType = targetObjectTypes[index]!;
    const response = await this.request<HubSpotAssociationResponse>({
      path: `/crm/v4/objects/${encodeURIComponent(input.record.objectType)}/${encodeURIComponent(input.record.remoteId)}/associations/${encodeURIComponent(targetObjectType)}${toQuery(
        {
          limit: String(Math.max(1, Math.min(MAX_PAGE_SIZE, input.limit))),
          ...(state.after ? { after: state.after } : {}),
        },
      )}`,
    });
    const relationships: CrmRelationship[] = [];
    for (const association of response.results ?? []) {
      const remoteId = association.toObjectId ?? association.id;
      if (remoteId == null) continue;
      const types = association.associationTypes?.length
        ? association.associationTypes
        : [
            {
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId: "default",
            },
          ];
      for (const type of types) {
        const relationshipType = [
          type.associationCategory ?? "HUBSPOT_DEFINED",
          type.associationTypeId == null
            ? "default"
            : String(type.associationTypeId),
        ].join(":");
        relationships.push({
          from: input.record,
          to: recordRef(
            this.workspaceConnection,
            targetObjectType,
            String(remoteId),
          ),
          relationshipType,
          ...(type.label ? { label: type.label } : {}),
        });
      }
    }
    const after = response.paging?.next?.after;
    const nextCursor = after
      ? encodedCursor(index, after)
      : index + 1 < targetObjectTypes.length
        ? encodeCursorState({ index: index + 1 })
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
          "HubSpot deletion is disabled during the phase-1 CRM transport rollout.",
      };
    }
    if (
      mutation.operation === "associate" ||
      mutation.operation === "disassociate"
    ) {
      return {
        status: "rejected" as const,
        message:
          "HubSpot association mutation requires an explicit association definition and is not enabled in phase 1.",
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
          "The workspace connection does not prove write access for this HubSpot object.",
      };
    }
    const fields = Object.entries(mutation.fields ?? {}).reduce<
      Record<string, CrmValue>
    >((result, [key, value]) => {
      if (key.trim()) result[key] = value;
      return result;
    }, {});
    if (!Object.keys(fields).length) {
      return {
        status: "rejected" as const,
        message: "At least one field is required.",
      };
    }
    if (mutation.operation === "update" && !mutation.expectedRemoteRevision) {
      return {
        status: "rejected" as const,
        message: "HubSpot updates require a current remote revision.",
      };
    }
    if (mutation.expectedRemoteRevision) {
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
            "The HubSpot record changed before this mutation could be applied.",
        };
      }
      if (!this.capabilities.conditionalMutations) {
        return {
          status: "rejected" as const,
          remoteRevision: current.remoteRevision,
          message:
            "HubSpot does not support an atomic conditional update for this record.",
        };
      }
    }
    try {
      const objectType = encodeURIComponent(mutation.record.objectType);
      const response = await this.request<HubSpotRecord>({
        method: mutation.operation === "create" ? "POST" : "PATCH",
        path:
          mutation.operation === "create"
            ? `/crm/v3/objects/${objectType}`
            : `/crm/v3/objects/${objectType}/${encodeURIComponent(mutation.record.remoteId)}`,
        body: { properties: fields },
        headers: { "X-Idempotency-Key": mutation.idempotencyKey },
      });
      const record = projectRecord(
        this.workspaceConnection,
        mutation.record.objectType,
        response,
        Object.keys(fields),
      );
      if (!record) {
        return {
          status: "rejected" as const,
          message: "HubSpot returned no record identity.",
        };
      }
      return {
        status: "applied" as const,
        record,
        ...(record.remoteRevision
          ? { remoteRevision: record.remoteRevision }
          : {}),
      };
    } catch (error) {
      return {
        status: "rejected" as const,
        message:
          error instanceof Error ? error.message : "HubSpot mutation failed.",
      };
    }
  }
}

function requireResolvedConnection(
  result: ResolvedWorkspaceConnectionForApp,
): WorkspaceConnectionForApp {
  if (!result.available || !result.connection) {
    throw new Error(
      `HubSpot workspace connection is unavailable: ${result.reason}`,
    );
  }
  return result.connection;
}

export async function createHubSpotCrmAdapter(
  options: CreateHubSpotCrmAdapterOptions = {},
): Promise<HubSpotCrmAdapter> {
  const resolved = await resolveWorkspaceConnectionForApp({
    appId: CRM_APP_ID,
    provider: "hubspot",
    ...(options.connectionId ? { connectionId: options.connectionId } : {}),
    requireConnected: true,
  });
  const connection = requireResolvedConnection(resolved);
  if (options.transport) {
    return new HubSpotCrmAdapter({ connection, transport: options.transport });
  }
  for (const key of HUBSPOT_CREDENTIAL_KEYS) {
    const credential = await resolveWorkspaceConnectionCredentialForApp({
      appId: CRM_APP_ID,
      provider: "hubspot",
      key,
      connectionId: connection.id,
      ...(options.userEmail ? { userEmail: options.userEmail } : {}),
      ...(options.orgId !== undefined ? { orgId: options.orgId } : {}),
    });
    if (!credential.available || !credential.value) continue;
    if (credential.provenance?.connectionId !== connection.id) continue;
    return new HubSpotCrmAdapter({
      connection,
      transport: new FetchHubSpotTransport(credential.value),
    });
  }
  throw new Error(
    "HubSpot workspace connection is unavailable: no scoped credential was resolved for the granted connection.",
  );
}
