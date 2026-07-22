import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, asc, eq, gt, inArray, isNull, like, or } from "drizzle-orm";

import type {
  CrmAccessScope,
  CrmAdapter,
  CrmAdapterCapabilities,
  CrmConnectionRef,
  CrmFieldDefinition,
  CrmMutation,
  CrmMutationResult,
  CrmObjectDefinition,
  CrmObjectKind,
  CrmRecord,
  CrmRecordRef,
  CrmRelationship,
  CrmSyncScope,
  CrmSyncPage,
  CrmValue,
} from "../../shared/crm-contract.js";
import { getDb, schema } from "../db/index.js";
import {
  isBoundedCrmValue,
  isSafeCrmMutationFieldName,
} from "./crm-field-firewall.js";

const MAX_PAGE_SIZE = 100;
const MAX_FIELDS = 80;
const MAX_MUTATION_FIELDS = 20;
const STANDARD_OBJECTS = ["accounts", "people", "opportunities"] as const;

type Ownership = {
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
};

type NativeConnection = Ownership & {
  id: string;
  accountId: string | null;
  accessScopeKey: string;
  accessScopeJson: string;
};

type StoredField = {
  fieldName: string;
  valueType: string;
  stringValue: string | null;
  numberValue: number | null;
  booleanValue: boolean | null;
  jsonValue: string | null;
};

function kindForObject(objectType: string): CrmObjectKind {
  if (objectType === "accounts") return "account";
  if (objectType === "people") return "person";
  if (objectType === "opportunities") return "opportunity";
  return "custom";
}

function labelForObject(objectType: string): string {
  if (objectType === "accounts") return "Account";
  if (objectType === "people") return "Person";
  if (objectType === "opportunities") return "Opportunity";
  return objectType
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function nativeField(
  name: string,
  valueType: CrmFieldDefinition["valueType"],
  required = false,
): CrmFieldDefinition {
  return {
    name,
    label: name
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (character) => character.toUpperCase()),
    valueType,
    storagePolicy: "local-authoritative",
    sensitive: false,
    readable: true,
    createable: true,
    updateable: true,
    required,
  };
}

export function nativeObjectTemplate(objectType: string): CrmObjectDefinition {
  const objectFields =
    objectType === "accounts"
      ? [
          nativeField("name", "string", true),
          nativeField("domain", "string"),
          nativeField("industry", "string"),
          nativeField("ownerName", "string"),
        ]
      : objectType === "people"
        ? [
            nativeField("firstName", "string"),
            nativeField("lastName", "string"),
            nativeField("email", "string"),
            nativeField("title", "string"),
            nativeField("accountId", "reference"),
            nativeField("ownerName", "string"),
          ]
        : objectType === "opportunities"
          ? [
              nativeField("name", "string", true),
              nativeField("amount", "currency"),
              nativeField("stage", "string"),
              nativeField("closeDate", "date"),
              nativeField("accountId", "reference"),
              nativeField("ownerName", "string"),
            ]
          : [];
  const fields = objectFields.length
    ? [
        ...objectFields,
        nativeField("desiredCadenceDays", "number"),
        nativeField("lastMeaningfulInteractionAt", "datetime"),
        nativeField("nextContactAt", "datetime"),
      ]
    : [];
  const label = labelForObject(objectType);
  return {
    connectionId: "",
    provider: "native",
    objectType,
    kind: kindForObject(objectType),
    label,
    pluralLabel: `${label}s`,
    custom: !STANDARD_OBJECTS.includes(
      objectType as (typeof STANDARD_OBJECTS)[number],
    ),
    queryable: true,
    searchable: true,
    createable: true,
    updateable: true,
    deleteable: true,
    fields,
  };
}

function valueType(value: CrmValue): CrmFieldDefinition["valueType"] {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value) || typeof value === "object") return "json";
  return "string";
}

function fieldColumns(value: CrmValue) {
  if (typeof value === "string") {
    return {
      stringValue: value,
      numberValue: null,
      booleanValue: null,
      jsonValue: null,
    };
  }
  if (typeof value === "number") {
    return {
      stringValue: null,
      numberValue: value,
      booleanValue: null,
      jsonValue: null,
    };
  }
  if (typeof value === "boolean") {
    return {
      stringValue: null,
      numberValue: null,
      booleanValue: value,
      jsonValue: null,
    };
  }
  if (value === null) {
    return {
      stringValue: null,
      numberValue: null,
      booleanValue: null,
      jsonValue: null,
    };
  }
  return {
    stringValue: null,
    numberValue: null,
    booleanValue: null,
    jsonValue: JSON.stringify(value),
  };
}

function fieldValue(field: StoredField): CrmValue {
  if (field.stringValue !== null) return field.stringValue;
  if (field.numberValue !== null) return field.numberValue;
  if (field.booleanValue !== null) return field.booleanValue;
  if (!field.jsonValue) return null;
  try {
    const value = JSON.parse(field.jsonValue) as unknown;
    return isBoundedCrmValue(value) ? (value as CrmValue) : null;
  } catch {
    return null;
  }
}

function encodeCursor(offset: number): string {
  return btoa(String(offset)).replace(/=+$/, "");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const value = Number.parseInt(atob(cursor), 10);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function nextNativeRevision(value: string | null | undefined): string {
  try {
    const parsed = BigInt(value ?? "0");
    return (parsed >= 0n ? parsed + 1n : 1n).toString();
  } catch {
    return "1";
  }
}

function scopeFromConnection(connection: NativeConnection): CrmAccessScope {
  try {
    const stored = JSON.parse(
      connection.accessScopeJson,
    ) as Partial<CrmAccessScope>;
    if (stored.mode === "native" && stored.key === connection.accessScopeKey) {
      return {
        key: stored.key,
        actorId: stored.actorId ?? connection.ownerEmail,
        mode: "native",
        objectReadable: true,
        objectCreateable: true,
        objectUpdateable: true,
        objectDeleteable: true,
        recordVisibility:
          stored.recordVisibility ??
          (connection.visibility === "org" ? "workspace" : "actor"),
        ...(stored.fieldPermissionsHash
          ? { fieldPermissionsHash: stored.fieldPermissionsHash }
          : {}),
        ...(stored.sharingFingerprint
          ? { sharingFingerprint: stored.sharingFingerprint }
          : {}),
      };
    }
  } catch {}
  return {
    key: connection.accessScopeKey,
    actorId: connection.ownerEmail,
    mode: "native",
    objectReadable: true,
    objectCreateable: true,
    objectUpdateable: true,
    objectDeleteable: true,
    recordVisibility: connection.visibility === "org" ? "workspace" : "actor",
  };
}

function json(value: unknown, maximum = 12_000): string {
  const encoded = JSON.stringify(value);
  if (encoded.length > maximum)
    throw new Error("CRM mutation payload exceeds the allowed size.");
  return encoded;
}

function mutationFields(mutation: CrmMutation): Record<string, CrmValue> {
  const fields = mutation.fields ?? {};
  const entries = Object.entries(fields);
  if (
    entries.length > MAX_MUTATION_FIELDS ||
    entries.some(
      ([name, value]) =>
        !name ||
        name.length > 120 ||
        !isSafeCrmMutationFieldName(name) ||
        !isBoundedCrmValue(value),
    )
  ) {
    throw new Error(
      "Native CRM mutations require bounded, non-media field values.",
    );
  }
  return fields;
}

function summaryColumns(fields: Record<string, CrmValue>, fallback: string) {
  const string = (...names: string[]) => {
    for (const name of names) {
      const value = fields[name];
      if (typeof value === "string") return value.slice(0, 500);
    }
    return null;
  };
  const number = (...names: string[]) => {
    for (const name of names) {
      const value = fields[name];
      if (typeof value === "number") return value;
    }
    return null;
  };
  const desiredCadenceDays = fields.desiredCadenceDays;
  if (
    desiredCadenceDays !== undefined &&
    desiredCadenceDays !== null &&
    (typeof desiredCadenceDays !== "number" ||
      !Number.isInteger(desiredCadenceDays) ||
      desiredCadenceDays < 1 ||
      desiredCadenceDays > 365)
  ) {
    throw new Error(
      "desiredCadenceDays must be null or an integer from 1 to 365.",
    );
  }
  return {
    displayName: string("displayName", "name", "Name") ?? fallback,
    primaryEmail: string("email", "Email"),
    domain: string("domain", "website", "Website"),
    stage: string("stage", "StageName"),
    ownerName: string("ownerName"),
    amount: number("amount", "Amount"),
    closeDate: string("closeDate", "CloseDate"),
    desiredCadenceDays: desiredCadenceDays ?? null,
    lastMeaningfulInteractionAt: string("lastMeaningfulInteractionAt"),
    nextContactAt: string("nextContactAt"),
  };
}

async function loadNativeConnection(
  connectionId: string,
  accessTier: "viewer" | "editor" = "viewer",
): Promise<NativeConnection> {
  await assertAccess("crm-connection", connectionId, accessTier);
  const db = getDb();
  const [connection] = await db
    .select({
      id: schema.crmConnections.id,
      accountId: schema.crmConnections.accountId,
      accessScopeKey: schema.crmConnections.accessScopeKey,
      accessScopeJson: schema.crmConnections.accessScopeJson,
      ownerEmail: schema.crmConnections.ownerEmail,
      orgId: schema.crmConnections.orgId,
      visibility: schema.crmConnections.visibility,
    })
    .from(schema.crmConnections)
    .where(
      and(
        eq(schema.crmConnections.id, connectionId),
        eq(schema.crmConnections.provider, "native"),
        accessFilter(
          schema.crmConnections,
          schema.crmConnectionShares,
          undefined,
          accessTier,
        ),
      ),
    )
    .limit(1);
  if (!connection) throw new Error("Native CRM connection is unavailable.");
  return connection as NativeConnection;
}

async function ensureNativeObject(input: {
  connection: NativeConnection;
  objectType: string;
  fields: CrmFieldDefinition[];
}) {
  const db = getDb();
  const template = nativeObjectTemplate(input.objectType);
  const object = { ...template, connectionId: input.connection.id };
  const [existing] = await db
    .select({ id: schema.crmObjects.id })
    .from(schema.crmObjects)
    .where(
      and(
        eq(schema.crmObjects.connectionId, input.connection.id),
        eq(schema.crmObjects.objectType, input.objectType),
        accessFilter(schema.crmObjects, schema.crmObjectShares),
      ),
    )
    .limit(1);
  const now = new Date().toISOString();
  const objectValues = {
    provider: "native" as const,
    objectType: input.objectType,
    kind: object.kind,
    label: object.label,
    pluralLabel: object.pluralLabel,
    custom: object.custom,
    queryable: true,
    searchable: true,
    createable: true,
    updateable: true,
    deleteable: true,
    capabilitiesJson: json(NATIVE_CAPABILITIES, 4_000),
    updatedAt: now,
  };
  if (existing) {
    await assertAccess("crm-object", existing.id, "editor");
    await db
      .update(schema.crmObjects)
      .set(objectValues)
      .where(
        and(
          eq(schema.crmObjects.id, existing.id),
          accessFilter(
            schema.crmObjects,
            schema.crmObjectShares,
            undefined,
            "editor",
          ),
        ),
      );
  } else {
    await db.insert(schema.crmObjects).values({
      id: crypto.randomUUID(),
      connectionId: input.connection.id,
      ...objectValues,
      ownerEmail: input.connection.ownerEmail,
      orgId: input.connection.orgId,
      visibility: input.connection.visibility,
      createdAt: now,
    });
  }
  const known = new Map<string, CrmFieldDefinition>();
  for (const field of [...template.fields, ...input.fields])
    known.set(field.name, field);
  const existingPolicies = await db
    .select({
      id: schema.crmFieldPolicies.id,
      fieldName: schema.crmFieldPolicies.fieldName,
    })
    .from(schema.crmFieldPolicies)
    .where(
      and(
        eq(schema.crmFieldPolicies.connectionId, input.connection.id),
        eq(schema.crmFieldPolicies.objectType, input.objectType),
        accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
      ),
    );
  const policyByName = new Map(
    existingPolicies.map((policy) => [policy.fieldName, policy]),
  );
  for (const field of known.values()) {
    const existingPolicy = policyByName.get(field.name);
    const values = {
      label: field.label,
      valueType: field.valueType,
      storagePolicy: "local-authoritative" as const,
      sensitive: false,
      readable: true,
      createable: true,
      updateable: true,
      required: field.required,
      metadataJson: "{}",
      updatedAt: now,
    };
    if (existingPolicy) {
      await assertAccess("crm-field-policy", existingPolicy.id, "editor");
      await db
        .update(schema.crmFieldPolicies)
        .set(values)
        .where(
          and(
            eq(schema.crmFieldPolicies.id, existingPolicy.id),
            accessFilter(
              schema.crmFieldPolicies,
              schema.crmFieldPolicyShares,
              undefined,
              "editor",
            ),
          ),
        );
    } else {
      await db.insert(schema.crmFieldPolicies).values({
        id: crypto.randomUUID(),
        connectionId: input.connection.id,
        objectType: input.objectType,
        fieldName: field.name,
        ...values,
        ownerEmail: input.connection.ownerEmail,
        orgId: input.connection.orgId,
        visibility: input.connection.visibility,
        createdAt: now,
      });
    }
  }
}

export async function initializeNativeCrmDomain(connectionId: string) {
  const connection = await loadNativeConnection(connectionId, "editor");
  await Promise.all(
    STANDARD_OBJECTS.map((objectType) =>
      ensureNativeObject({ connection, objectType, fields: [] }),
    ),
  );
}

export async function configureNativeCrmConnection(input: {
  label?: string;
  ownership: Ownership;
}) {
  const db = getDb();
  const label = input.label?.trim() || "Native SQL";
  const [existing] = await db
    .select({ id: schema.crmConnections.id })
    .from(schema.crmConnections)
    .where(
      and(
        eq(schema.crmConnections.provider, "native"),
        eq(schema.crmConnections.label, label),
        accessFilter(schema.crmConnections, schema.crmConnectionShares),
      ),
    )
    .limit(1);
  const id = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const accessScope: CrmAccessScope = {
    key: `native:${id}`,
    actorId: input.ownership.ownerEmail,
    mode: "native",
    objectReadable: true,
    objectCreateable: true,
    objectUpdateable: true,
    objectDeleteable: true,
    recordVisibility:
      input.ownership.visibility === "org" ? "workspace" : "actor",
  };
  const values = {
    provider: "native" as const,
    workspaceConnectionId: null,
    label,
    accountId: null,
    mode: "native" as const,
    status: "connected" as const,
    selectedPipelinesJson: "[]",
    selectedObjectTypesJson: json(STANDARD_OBJECTS, 1_000),
    accessScopeKey: accessScope.key,
    accessScopeJson: json(accessScope, 4_000),
    lastError: null,
    updatedAt: now,
  };
  if (existing) {
    await assertAccess("crm-connection", existing.id, "editor");
    await db
      .update(schema.crmConnections)
      .set(values)
      .where(
        and(
          eq(schema.crmConnections.id, existing.id),
          accessFilter(
            schema.crmConnections,
            schema.crmConnectionShares,
            undefined,
            "editor",
          ),
        ),
      );
  } else {
    await db.insert(schema.crmConnections).values({
      id,
      ...values,
      ownerEmail: input.ownership.ownerEmail,
      orgId: input.ownership.orgId,
      visibility: input.ownership.visibility,
      createdAt: now,
    });
  }
  await initializeNativeCrmDomain(id);
  return { id, label, accessScope, ...input.ownership };
}

export async function resolveNativeCrmAccessScope(input: {
  connectionId: string;
  objectType: string;
}): Promise<CrmAccessScope | null> {
  const connection = await loadNativeConnection(input.connectionId);
  const db = getDb();
  const [object] = await db
    .select({ id: schema.crmObjects.id })
    .from(schema.crmObjects)
    .where(
      and(
        eq(schema.crmObjects.connectionId, connection.id),
        eq(schema.crmObjects.objectType, input.objectType),
        accessFilter(schema.crmObjects, schema.crmObjectShares),
      ),
    )
    .limit(1);
  return object ? scopeFromConnection(connection) : null;
}

async function fieldsForRecord(recordId: string, requested?: string[]) {
  const db = getDb();
  const rows = await db
    .select({
      fieldName: schema.crmRecordFields.fieldName,
      valueType: schema.crmRecordFields.valueType,
      stringValue: schema.crmRecordFields.stringValue,
      numberValue: schema.crmRecordFields.numberValue,
      booleanValue: schema.crmRecordFields.booleanValue,
      jsonValue: schema.crmRecordFields.jsonValue,
    })
    .from(schema.crmRecordFields)
    .where(
      and(
        eq(schema.crmRecordFields.recordId, recordId),
        eq(schema.crmRecordFields.storagePolicy, "local-authoritative"),
        accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
      ),
    );
  const allowed = requested?.length ? new Set(requested) : null;
  return Object.fromEntries(
    rows
      .filter((field) => !allowed || allowed.has(field.fieldName))
      .map((field) => [field.fieldName, fieldValue(field as StoredField)]),
  ) as Record<string, CrmValue>;
}

async function materializeRecord(input: {
  row: typeof schema.crmRecords.$inferSelect;
  connection: NativeConnection;
  fields?: string[];
}): Promise<CrmRecord> {
  const fields = await fieldsForRecord(input.row.id, input.fields);
  const scope = scopeFromConnection(input.connection);
  const observedAt = input.row.updatedAt;
  return {
    ref: {
      connectionId: input.connection.id,
      provider: "native",
      accountId: input.connection.accountId ?? undefined,
      actorId: scope.actorId,
      objectType: input.row.objectType,
      kind: input.row.kind as CrmObjectKind,
      remoteId: input.row.remoteId,
      localId: input.row.id,
    },
    displayName: input.row.displayName,
    fields,
    remoteRevision: input.row.remoteRevision ?? undefined,
    remoteUpdatedAt: input.row.remoteUpdatedAt ?? undefined,
    deleted: input.row.tombstone,
    accessScope: scope,
    provenance: Object.keys(fields).map((fieldName) => ({
      provider: "native",
      connectionId: input.connection.id,
      objectType: input.row.objectType,
      remoteId: input.row.remoteId,
      fieldName,
      remoteRevision: input.row.remoteRevision ?? undefined,
      observedAt,
    })),
  };
}

const NATIVE_CAPABILITIES: CrmAdapterCapabilities = {
  schemaDiscovery: true,
  customObjects: true,
  search: true,
  incrementalSync: true,
  deletedRecordSync: true,
  conditionalMutations: true,
  labeledRelationships: true,
  perFieldPermissions: true,
  perRecordPermissions: true,
};

export class NativeCrmAdapter implements CrmAdapter {
  readonly capabilities = NATIVE_CAPABILITIES;
  readonly connection: CrmConnectionRef;
  readonly #nativeConnection: NativeConnection;
  readonly #initiatedBy: "human" | "agent" | "automation";

  constructor(
    connection: NativeConnection,
    initiatedBy: "human" | "agent" | "automation" = "agent",
  ) {
    this.#nativeConnection = connection;
    this.#initiatedBy = initiatedBy;
    const scope = scopeFromConnection(connection);
    this.connection = {
      connectionId: connection.id,
      provider: "native",
      ...(connection.accountId ? { accountId: connection.accountId } : {}),
      ...(scope.actorId ? { actorId: scope.actorId } : {}),
    };
  }

  getAccessScope(): CrmAccessScope {
    return scopeFromConnection(this.#nativeConnection);
  }

  async discoverObjects(): Promise<CrmObjectDefinition[]> {
    const db = getDb();
    const objects = await db
      .select()
      .from(schema.crmObjects)
      .where(
        and(
          eq(schema.crmObjects.connectionId, this.connection.connectionId),
          eq(schema.crmObjects.provider, "native"),
          accessFilter(schema.crmObjects, schema.crmObjectShares),
        ),
      )
      .orderBy(asc(schema.crmObjects.objectType));
    return Promise.all(
      objects.map((object) => this.describeObject(object.objectType)),
    );
  }

  async describeObject(objectType: string): Promise<CrmObjectDefinition> {
    const db = getDb();
    const [object] = await db
      .select()
      .from(schema.crmObjects)
      .where(
        and(
          eq(schema.crmObjects.connectionId, this.connection.connectionId),
          eq(schema.crmObjects.objectType, objectType),
          accessFilter(schema.crmObjects, schema.crmObjectShares),
        ),
      )
      .limit(1);
    if (!object)
      throw new Error(`Native CRM object ${objectType} is not registered.`);
    const policies = await db
      .select()
      .from(schema.crmFieldPolicies)
      .where(
        and(
          eq(
            schema.crmFieldPolicies.connectionId,
            this.connection.connectionId,
          ),
          eq(schema.crmFieldPolicies.objectType, objectType),
          accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
        ),
      )
      .orderBy(asc(schema.crmFieldPolicies.fieldName));
    return {
      ...this.connection,
      objectType,
      kind: object.kind as CrmObjectKind,
      label: object.label,
      pluralLabel: object.pluralLabel,
      custom: object.custom,
      queryable: object.queryable,
      searchable: object.searchable,
      createable: object.createable,
      updateable: object.updateable,
      deleteable: object.deleteable,
      fields: policies.map((policy) => ({
        name: policy.fieldName,
        label: policy.label,
        valueType: policy.valueType as CrmFieldDefinition["valueType"],
        storagePolicy: "local-authoritative",
        sensitive: policy.sensitive,
        readable: policy.readable,
        createable: policy.createable,
        updateable: policy.updateable,
        required: policy.required,
      })),
    };
  }

  async syncPage(input: {
    scope: CrmSyncScope;
    fieldAllowList: string[];
    cursor?: string;
    limit: number;
  }): Promise<CrmSyncPage> {
    const db = getDb();
    const limit = Math.min(Math.max(input.limit, 1), MAX_PAGE_SIZE);
    const offset = decodeCursor(input.cursor);
    const conditions = [
      eq(schema.crmRecords.connectionId, this.connection.connectionId),
      eq(schema.crmRecords.provider, "native"),
      eq(schema.crmRecords.objectType, input.scope.objectType),
      accessFilter(schema.crmRecords, schema.crmRecordShares),
    ];
    if (!input.scope.includeDeleted)
      conditions.push(eq(schema.crmRecords.tombstone, false));
    if (input.scope.recordIds?.length)
      conditions.push(
        inArray(schema.crmRecords.remoteId, input.scope.recordIds),
      );
    if (input.scope.ownerIds?.length)
      conditions.push(
        inArray(schema.crmRecords.ownerRemoteId, input.scope.ownerIds),
      );
    if (input.scope.pipelineIds?.length)
      conditions.push(
        inArray(schema.crmRecords.pipelineId, input.scope.pipelineIds),
      );
    if (input.scope.updatedAfter)
      conditions.push(
        gt(schema.crmRecords.updatedAt, input.scope.updatedAfter),
      );
    if (input.scope.associatedRecordIds?.length) {
      throw new Error(
        "Native CRM sync does not infer associated-record cohorts; use explicit recordIds.",
      );
    }
    const rows = await db
      .select()
      .from(schema.crmRecords)
      .where(and(...conditions))
      .orderBy(asc(schema.crmRecords.updatedAt), asc(schema.crmRecords.id))
      .limit(limit + 1)
      .offset(offset);
    const page = rows.slice(0, limit);
    return {
      records: await Promise.all(
        page.map((row) =>
          materializeRecord({
            row,
            connection: this.#nativeConnection,
            fields: input.fieldAllowList.slice(0, MAX_FIELDS),
          }),
        ),
      ),
      relationships: [],
      ...(rows.length > limit
        ? { nextCursor: encodeCursor(offset + limit) }
        : {}),
      complete: rows.length <= limit,
    };
  }

  async getRecord(input: {
    record: CrmRecordRef;
    fields: string[];
  }): Promise<CrmRecord | null> {
    const db = getDb();
    const conditions = [
      eq(schema.crmRecords.connectionId, this.connection.connectionId),
      eq(schema.crmRecords.provider, "native"),
      eq(schema.crmRecords.objectType, input.record.objectType),
      eq(schema.crmRecords.remoteId, input.record.remoteId),
      accessFilter(schema.crmRecords, schema.crmRecordShares),
    ];
    if (input.record.localId)
      conditions.push(eq(schema.crmRecords.id, input.record.localId));
    const [row] = await db
      .select()
      .from(schema.crmRecords)
      .where(and(...conditions))
      .limit(1);
    return row
      ? materializeRecord({
          row,
          connection: this.#nativeConnection,
          fields: input.fields.slice(0, MAX_FIELDS),
        })
      : null;
  }

  async search(input: {
    objectTypes: string[];
    query: string;
    fields: string[];
    limit: number;
    cursor?: string;
  }): Promise<CrmSyncPage> {
    if (!input.objectTypes.length || input.objectTypes.length > 50)
      throw new Error("Native CRM search requires 1 to 50 object types.");
    const db = getDb();
    const limit = Math.min(Math.max(input.limit, 1), MAX_PAGE_SIZE);
    const offset = decodeCursor(input.cursor);
    const query = input.query.trim().slice(0, 120);
    const rows = await db
      .select()
      .from(schema.crmRecords)
      .where(
        and(
          eq(schema.crmRecords.connectionId, this.connection.connectionId),
          eq(schema.crmRecords.provider, "native"),
          eq(schema.crmRecords.tombstone, false),
          inArray(schema.crmRecords.objectType, input.objectTypes),
          or(
            like(schema.crmRecords.displayName, `%${query}%`),
            like(schema.crmRecords.primaryEmail, `%${query}%`),
            like(schema.crmRecords.domain, `%${query}%`),
          ),
          accessFilter(schema.crmRecords, schema.crmRecordShares),
        ),
      )
      .orderBy(asc(schema.crmRecords.displayName), asc(schema.crmRecords.id))
      .limit(limit + 1)
      .offset(offset);
    const page = rows.slice(0, limit);
    return {
      records: await Promise.all(
        page.map((row) =>
          materializeRecord({
            row,
            connection: this.#nativeConnection,
            fields: input.fields.slice(0, MAX_FIELDS),
          }),
        ),
      ),
      relationships: [],
      ...(rows.length > limit
        ? { nextCursor: encodeCursor(offset + limit) }
        : {}),
      complete: rows.length <= limit,
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
    const source = await this.getRecord({ record: input.record, fields: [] });
    if (!source?.ref.localId) return { relationships: [], complete: true };
    const db = getDb();
    const limit = Math.min(Math.max(input.limit, 1), MAX_PAGE_SIZE);
    const rows = await db
      .select()
      .from(schema.crmRelationships)
      .where(
        and(
          eq(
            schema.crmRelationships.connectionId,
            this.connection.connectionId,
          ),
          eq(schema.crmRelationships.fromRecordId, source.ref.localId),
          eq(schema.crmRelationships.tombstone, false),
          accessFilter(schema.crmRelationships, schema.crmRelationshipShares),
        ),
      )
      .orderBy(asc(schema.crmRelationships.id))
      .limit(limit + 1)
      .offset(decodeCursor(input.cursor));
    const page = rows.slice(0, limit);
    const targetIds = page.map((row) => row.toRecordId);
    if (!targetIds.length)
      return { relationships: [], complete: rows.length <= limit };
    const targets = await db
      .select()
      .from(schema.crmRecords)
      .where(
        and(
          inArray(schema.crmRecords.id, targetIds),
          eq(schema.crmRecords.connectionId, this.connection.connectionId),
          eq(schema.crmRecords.tombstone, false),
          accessFilter(schema.crmRecords, schema.crmRecordShares),
        ),
      );
    const byId = new Map(targets.map((target) => [target.id, target]));
    const relationships = page.flatMap((relationship) => {
      const target = byId.get(relationship.toRecordId);
      if (
        !target ||
        (input.targetObjectTypes?.length &&
          !input.targetObjectTypes.includes(target.objectType))
      )
        return [];
      return [
        {
          from: source.ref,
          to: {
            ...this.connection,
            objectType: target.objectType,
            kind: target.kind as CrmObjectKind,
            remoteId: target.remoteId,
            localId: target.id,
          },
          relationshipType: relationship.relationshipType,
          ...(relationship.label ? { label: relationship.label } : {}),
          ...(relationship.inverseLabel
            ? { inverseLabel: relationship.inverseLabel }
            : {}),
          ...(relationship.sourceField
            ? { sourceField: relationship.sourceField }
            : {}),
        },
      ];
    });
    const offset = decodeCursor(input.cursor);
    return {
      relationships,
      ...(rows.length > limit
        ? { nextCursor: encodeCursor(offset + limit) }
        : {}),
      complete: rows.length <= limit,
    };
  }

  async applyMutation(mutation: CrmMutation): Promise<CrmMutationResult> {
    if (
      mutation.record.connectionId !== this.connection.connectionId ||
      mutation.record.provider !== "native"
    ) {
      return {
        status: "rejected",
        message: "Native CRM mutations must target this native connection.",
      };
    }
    if (!mutation.idempotencyKey || mutation.idempotencyKey.length > 256) {
      return {
        status: "rejected",
        message: "Native CRM mutations require a bounded idempotency key.",
      };
    }
    const fields = mutationFields(mutation);
    if (mutation.operation === "create")
      return this.createRecord(mutation, fields);
    if (mutation.operation === "update")
      return this.updateRecord(mutation, fields);
    if (mutation.operation === "delete") return this.deleteRecord(mutation);
    if (
      mutation.operation === "associate" ||
      mutation.operation === "disassociate"
    ) {
      return this.mutateRelationship(mutation);
    }
    return { status: "rejected", message: "Unsupported native CRM mutation." };
  }

  private async replayOrStart(mutation: CrmMutation, patchJson: string) {
    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.crmMutations)
      .where(
        and(
          eq(schema.crmMutations.idempotencyKey, mutation.idempotencyKey),
          accessFilter(schema.crmMutations, schema.crmMutationShares),
        ),
      )
      .limit(1);
    if (!existing) return null;
    if (
      existing.operation !== mutation.operation ||
      existing.patchJson !== patchJson
    ) {
      throw new Error(
        "Native CRM idempotency key was already used for a different mutation.",
      );
    }
    if (existing.status === "conflict")
      return {
        status: "conflict" as const,
        message: existing.error ?? undefined,
      };
    const record = existing.recordId
      ? await this.getRecord({
          record: { ...mutation.record, localId: existing.recordId },
          fields: [],
        })
      : null;
    return {
      status: "applied" as const,
      ...(record ? { record, remoteRevision: record.remoteRevision } : {}),
    };
  }

  private async createRecord(
    mutation: CrmMutation,
    fields: Record<string, CrmValue>,
  ): Promise<CrmMutationResult> {
    const objectType = mutation.record.objectType;
    await ensureNativeObject({
      connection: this.#nativeConnection,
      objectType,
      fields: Object.entries(fields).map(([name, value]) =>
        nativeField(name, valueType(value)),
      ),
    });
    const patchJson = json({ fields });
    const replay = await this.replayOrStart(mutation, patchJson);
    if (replay) return replay;
    const db = getDb();
    const remoteId = mutation.record.remoteId || crypto.randomUUID();
    const recordId = crypto.randomUUID();
    const now = new Date().toISOString();
    const revision = "1";
    try {
      await db.transaction(async (tx) => {
        const [duplicate] = await tx
          .select({ id: schema.crmRecords.id })
          .from(schema.crmRecords)
          .where(
            and(
              eq(schema.crmRecords.connectionId, this.connection.connectionId),
              eq(schema.crmRecords.objectType, objectType),
              eq(schema.crmRecords.remoteId, remoteId),
              accessFilter(schema.crmRecords, schema.crmRecordShares),
            ),
          )
          .limit(1);
        if (duplicate) throw new Error("NATIVE_CRM_DUPLICATE_RECORD");
        await tx.insert(schema.crmRecords).values({
          id: recordId,
          connectionId: this.connection.connectionId,
          provider: "native",
          objectType,
          kind: kindForObject(objectType),
          remoteId,
          ...summaryColumns(fields, remoteId),
          remoteRevision: revision,
          remoteUpdatedAt: now,
          accessScopeKey: this.getAccessScope().key,
          accessScopeJson: json(this.getAccessScope(), 4_000),
          tombstone: false,
          ownerEmail: this.#nativeConnection.ownerEmail,
          orgId: this.#nativeConnection.orgId,
          visibility: this.#nativeConnection.visibility,
          createdAt: now,
          updatedAt: now,
        });
        for (const [fieldName, value] of Object.entries(fields)) {
          await tx.insert(schema.crmRecordFields).values({
            id: crypto.randomUUID(),
            recordId,
            fieldName,
            valueType: valueType(value),
            storagePolicy: "local-authoritative",
            ...fieldColumns(value),
            provenanceJson: json(
              [
                {
                  provider: "native",
                  connectionId: this.connection.connectionId,
                  objectType,
                  remoteId,
                  fieldName,
                  remoteRevision: revision,
                  observedAt: now,
                },
              ],
              4_000,
            ),
            accessScopeKey: this.getAccessScope().key,
            accessScopeJson: json(this.getAccessScope(), 4_000),
            remoteRevision: revision,
            ownerEmail: this.#nativeConnection.ownerEmail,
            orgId: this.#nativeConnection.orgId,
            visibility: this.#nativeConnection.visibility,
            createdAt: now,
            updatedAt: now,
          });
        }
        await tx.insert(schema.crmMutations).values({
          id: crypto.randomUUID(),
          recordId,
          connectionId: this.connection.connectionId,
          operation: "create",
          initiatedBy: this.#initiatedBy,
          target: "local",
          policyDecision: "execute",
          risk: "routine",
          status: "applied",
          patchJson,
          beforeJson: "{}",
          afterJson: json({ remoteId, revision }),
          idempotencyKey: mutation.idempotencyKey,
          providerRemoteRevision: revision,
          appliedAt: now,
          ownerEmail: this.#nativeConnection.ownerEmail,
          orgId: this.#nativeConnection.orgId,
          visibility: this.#nativeConnection.visibility,
          createdAt: now,
          updatedAt: now,
        });
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "NATIVE_CRM_DUPLICATE_RECORD"
      )
        return {
          status: "conflict",
          message: "A native CRM record with this id already exists.",
        };
      throw error;
    }
    const record = await this.getRecord({
      record: { ...mutation.record, remoteId, localId: recordId },
      fields: Object.keys(fields),
    });
    return record
      ? { status: "applied", record, remoteRevision: revision }
      : { status: "rejected", message: "Native CRM record was not persisted." };
  }

  private async updateRecord(
    mutation: CrmMutation,
    fields: Record<string, CrmValue>,
  ): Promise<CrmMutationResult> {
    await ensureNativeObject({
      connection: this.#nativeConnection,
      objectType: mutation.record.objectType,
      fields: Object.entries(fields).map(([name, value]) =>
        nativeField(name, valueType(value)),
      ),
    });
    const patchJson = json({ fields });
    const replay = await this.replayOrStart(mutation, patchJson);
    if (replay) return replay;
    const db = getDb();
    const [record] = await db
      .select()
      .from(schema.crmRecords)
      .where(
        and(
          eq(schema.crmRecords.connectionId, this.connection.connectionId),
          eq(schema.crmRecords.objectType, mutation.record.objectType),
          eq(schema.crmRecords.remoteId, mutation.record.remoteId),
          accessFilter(
            schema.crmRecords,
            schema.crmRecordShares,
            undefined,
            "editor",
          ),
        ),
      )
      .limit(1);
    if (!record || record.tombstone)
      return {
        status: "rejected",
        message: "Native CRM record is unavailable.",
      };
    await assertAccess("crm-record", record.id, "editor");
    if (
      mutation.expectedRemoteRevision &&
      mutation.expectedRemoteRevision !== record.remoteRevision
    )
      return {
        status: "conflict",
        message: "Native CRM record revision changed.",
      };
    const current = await fieldsForRecord(record.id);
    const merged = { ...current, ...fields };
    const revision = nextNativeRevision(record.remoteRevision);
    const now = new Date().toISOString();
    const revisionGuard =
      record.remoteRevision === null
        ? isNull(schema.crmRecords.remoteRevision)
        : eq(schema.crmRecords.remoteRevision, record.remoteRevision);
    try {
      await db.transaction(async (tx) => {
        const guarded = await tx
          .update(schema.crmRecords)
          .set({
            ...summaryColumns(merged, record.remoteId),
            remoteRevision: revision,
            remoteUpdatedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.crmRecords.id, record.id),
              revisionGuard,
              accessFilter(
                schema.crmRecords,
                schema.crmRecordShares,
                undefined,
                "editor",
              ),
            ),
          )
          .returning({ id: schema.crmRecords.id });
        if (guarded.length !== 1)
          throw new Error("NATIVE_CRM_REVISION_CONFLICT");
        for (const [fieldName, value] of Object.entries(fields)) {
          const [existing] = await tx
            .select({ id: schema.crmRecordFields.id })
            .from(schema.crmRecordFields)
            .where(
              and(
                eq(schema.crmRecordFields.recordId, record.id),
                eq(schema.crmRecordFields.fieldName, fieldName),
                accessFilter(
                  schema.crmRecordFields,
                  schema.crmRecordFieldShares,
                  undefined,
                  "editor",
                ),
              ),
            )
            .limit(1);
          const values = {
            valueType: valueType(value),
            storagePolicy: "local-authoritative" as const,
            ...fieldColumns(value),
            provenanceJson: json(
              [
                {
                  provider: "native",
                  connectionId: this.connection.connectionId,
                  objectType: record.objectType,
                  remoteId: record.remoteId,
                  fieldName,
                  remoteRevision: revision,
                  observedAt: now,
                },
              ],
              4_000,
            ),
            accessScopeKey: this.getAccessScope().key,
            accessScopeJson: json(this.getAccessScope(), 4_000),
            remoteRevision: revision,
            updatedAt: now,
          };
          if (existing) {
            await tx
              .update(schema.crmRecordFields)
              .set(values)
              .where(
                and(
                  eq(schema.crmRecordFields.id, existing.id),
                  accessFilter(
                    schema.crmRecordFields,
                    schema.crmRecordFieldShares,
                    undefined,
                    "editor",
                  ),
                ),
              );
          } else {
            await tx.insert(schema.crmRecordFields).values({
              id: crypto.randomUUID(),
              recordId: record.id,
              fieldName,
              ...values,
              ownerEmail: record.ownerEmail,
              orgId: record.orgId,
              visibility: record.visibility,
              createdAt: now,
            });
          }
        }
        await tx.insert(schema.crmMutations).values({
          id: crypto.randomUUID(),
          recordId: record.id,
          connectionId: this.connection.connectionId,
          operation: "update",
          initiatedBy: this.#initiatedBy,
          target: "local",
          policyDecision: "execute",
          risk: "routine",
          status: "applied",
          patchJson,
          beforeJson: json({ remoteRevision: record.remoteRevision }),
          afterJson: json({ remoteRevision: revision }),
          idempotencyKey: mutation.idempotencyKey,
          expectedRemoteRevision: mutation.expectedRemoteRevision ?? null,
          providerRemoteRevision: revision,
          appliedAt: now,
          ownerEmail: record.ownerEmail,
          orgId: record.orgId,
          visibility: record.visibility,
          createdAt: now,
          updatedAt: now,
        });
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "NATIVE_CRM_REVISION_CONFLICT"
      )
        return {
          status: "conflict",
          message: "Native CRM record revision changed.",
        };
      throw error;
    }
    const updated = await this.getRecord({
      record: mutation.record,
      fields: Object.keys(merged),
    });
    return updated
      ? { status: "applied", record: updated, remoteRevision: revision }
      : { status: "rejected", message: "Native CRM record was not updated." };
  }

  private async deleteRecord(
    mutation: CrmMutation,
  ): Promise<CrmMutationResult> {
    const patchJson = "{}";
    const replay = await this.replayOrStart(mutation, patchJson);
    if (replay) return replay;
    const db = getDb();
    const [record] = await db
      .select()
      .from(schema.crmRecords)
      .where(
        and(
          eq(schema.crmRecords.connectionId, this.connection.connectionId),
          eq(schema.crmRecords.objectType, mutation.record.objectType),
          eq(schema.crmRecords.remoteId, mutation.record.remoteId),
          accessFilter(
            schema.crmRecords,
            schema.crmRecordShares,
            undefined,
            "editor",
          ),
        ),
      )
      .limit(1);
    if (!record)
      return {
        status: "rejected",
        message: "Native CRM record is unavailable.",
      };
    await assertAccess("crm-record", record.id, "editor");
    if (
      mutation.expectedRemoteRevision &&
      mutation.expectedRemoteRevision !== record.remoteRevision
    )
      return {
        status: "conflict",
        message: "Native CRM record revision changed.",
      };
    const revision = nextNativeRevision(record.remoteRevision);
    const now = new Date().toISOString();
    const revisionGuard =
      record.remoteRevision === null
        ? isNull(schema.crmRecords.remoteRevision)
        : eq(schema.crmRecords.remoteRevision, record.remoteRevision);
    try {
      await db.transaction(async (tx) => {
        const guarded = await tx
          .update(schema.crmRecords)
          .set({
            tombstone: true,
            remoteRevision: revision,
            remoteUpdatedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.crmRecords.id, record.id),
              revisionGuard,
              accessFilter(
                schema.crmRecords,
                schema.crmRecordShares,
                undefined,
                "editor",
              ),
            ),
          )
          .returning({ id: schema.crmRecords.id });
        if (guarded.length !== 1)
          throw new Error("NATIVE_CRM_REVISION_CONFLICT");
        const relationships = await tx
          .select({ id: schema.crmRelationships.id })
          .from(schema.crmRelationships)
          .where(
            and(
              eq(
                schema.crmRelationships.connectionId,
                this.connection.connectionId,
              ),
              or(
                eq(schema.crmRelationships.fromRecordId, record.id),
                eq(schema.crmRelationships.toRecordId, record.id),
              ),
              accessFilter(
                schema.crmRelationships,
                schema.crmRelationshipShares,
                undefined,
                "editor",
              ),
            ),
          );
        for (const relationship of relationships) {
          await assertAccess("crm-relationship", relationship.id, "editor");
          await tx
            .update(schema.crmRelationships)
            .set({ tombstone: true, updatedAt: now })
            .where(
              and(
                eq(schema.crmRelationships.id, relationship.id),
                accessFilter(
                  schema.crmRelationships,
                  schema.crmRelationshipShares,
                  undefined,
                  "editor",
                ),
              ),
            );
        }
        await tx.insert(schema.crmMutations).values({
          id: crypto.randomUUID(),
          recordId: record.id,
          connectionId: this.connection.connectionId,
          operation: "delete",
          initiatedBy: this.#initiatedBy,
          target: "local",
          policyDecision: "execute",
          risk: "routine",
          status: "applied",
          patchJson,
          beforeJson: json({ remoteRevision: record.remoteRevision }),
          afterJson: json({ remoteRevision: revision, tombstone: true }),
          idempotencyKey: mutation.idempotencyKey,
          expectedRemoteRevision: mutation.expectedRemoteRevision ?? null,
          providerRemoteRevision: revision,
          appliedAt: now,
          ownerEmail: record.ownerEmail,
          orgId: record.orgId,
          visibility: record.visibility,
          createdAt: now,
          updatedAt: now,
        });
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "NATIVE_CRM_REVISION_CONFLICT"
      )
        return {
          status: "conflict",
          message: "Native CRM record revision changed.",
        };
      throw error;
    }
    const deleted = await this.getRecord({
      record: mutation.record,
      fields: [],
    });
    return {
      status: "applied",
      ...(deleted ? { record: deleted } : {}),
      remoteRevision: revision,
    };
  }

  private async mutateRelationship(
    mutation: CrmMutation,
  ): Promise<CrmMutationResult> {
    if (!mutation.relationship)
      return {
        status: "rejected",
        message: "Native relationship mutations require an edge.",
      };
    const patchJson = json({ relationship: mutation.relationship });
    const replay = await this.replayOrStart(mutation, patchJson);
    if (replay) return replay;
    const from = await this.getRecord({
      record: mutation.relationship.from,
      fields: [],
    });
    const to = await this.getRecord({
      record: mutation.relationship.to,
      fields: [],
    });
    if (!from?.ref.localId || !to?.ref.localId)
      return {
        status: "rejected",
        message: "Native relationship records are unavailable.",
      };
    await assertAccess("crm-record", from.ref.localId, "editor");
    await assertAccess("crm-record", to.ref.localId, "editor");
    const db = getDb();
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: schema.crmRelationships.id })
        .from(schema.crmRelationships)
        .where(
          and(
            eq(
              schema.crmRelationships.connectionId,
              this.connection.connectionId,
            ),
            eq(schema.crmRelationships.fromRecordId, from.ref.localId!),
            eq(schema.crmRelationships.toRecordId, to.ref.localId!),
            eq(
              schema.crmRelationships.relationshipType,
              mutation.relationship!.relationshipType,
            ),
            accessFilter(
              schema.crmRelationships,
              schema.crmRelationshipShares,
              undefined,
              "editor",
            ),
          ),
        )
        .limit(1);
      if (existing) {
        await assertAccess("crm-relationship", existing.id, "editor");
        await tx
          .update(schema.crmRelationships)
          .set({
            tombstone: mutation.operation === "disassociate",
            label: mutation.relationship!.label ?? null,
            inverseLabel: mutation.relationship!.inverseLabel ?? null,
            sourceField: mutation.relationship!.sourceField ?? null,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.crmRelationships.id, existing.id),
              accessFilter(
                schema.crmRelationships,
                schema.crmRelationshipShares,
                undefined,
                "editor",
              ),
            ),
          );
      } else if (mutation.operation === "associate") {
        await tx.insert(schema.crmRelationships).values({
          id: crypto.randomUUID(),
          connectionId: this.connection.connectionId,
          fromRecordId: from.ref.localId!,
          toRecordId: to.ref.localId!,
          relationshipType: mutation.relationship!.relationshipType,
          label: mutation.relationship!.label ?? null,
          inverseLabel: mutation.relationship!.inverseLabel ?? null,
          sourceField: mutation.relationship!.sourceField ?? null,
          tombstone: false,
          ownerEmail: this.#nativeConnection.ownerEmail,
          orgId: this.#nativeConnection.orgId,
          visibility: this.#nativeConnection.visibility,
          createdAt: now,
          updatedAt: now,
        });
      }
      await tx.insert(schema.crmMutations).values({
        id: crypto.randomUUID(),
        recordId: from.ref.localId,
        connectionId: this.connection.connectionId,
        operation: mutation.operation,
        initiatedBy: this.#initiatedBy,
        target: "local",
        policyDecision: "execute",
        risk: "routine",
        status: "applied",
        patchJson,
        beforeJson: "{}",
        afterJson: json({ relationship: mutation.operation }),
        idempotencyKey: mutation.idempotencyKey,
        appliedAt: now,
        ownerEmail: this.#nativeConnection.ownerEmail,
        orgId: this.#nativeConnection.orgId,
        visibility: this.#nativeConnection.visibility,
        createdAt: now,
        updatedAt: now,
      });
    });
    return {
      status: "applied",
      record: from,
      remoteRevision: from.remoteRevision,
    };
  }
}

export async function createNativeCrmAdapter(options: {
  connectionId: string;
  initiatedBy?: "human" | "agent" | "automation";
  accessTier?: "viewer" | "editor";
}): Promise<NativeCrmAdapter> {
  const accessTier = options.accessTier ?? "editor";
  const connection = await loadNativeConnection(
    options.connectionId,
    accessTier,
  );
  if (accessTier === "editor") {
    await initializeNativeCrmDomain(options.connectionId);
  }
  return new NativeCrmAdapter(connection, options.initiatedBy);
}

export async function createNativeCrmRecord(input: {
  connectionId: string;
  kind: "account" | "person" | "opportunity";
  displayName: string;
  fields: Record<string, CrmValue>;
  idempotencyKey?: string;
  initiatedBy?: "human" | "agent" | "automation";
}) {
  const objectType =
    input.kind === "account"
      ? "accounts"
      : input.kind === "person"
        ? "people"
        : "opportunities";
  const adapter = await createNativeCrmAdapter({
    connectionId: input.connectionId,
    initiatedBy: input.initiatedBy,
  });
  return adapter.applyMutation({
    operation: "create",
    record: {
      ...adapter.connection,
      objectType,
      kind: input.kind,
      remoteId: `native-${crypto.randomUUID()}`,
    },
    fields: { ...input.fields, displayName: input.displayName },
    idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
  });
}
