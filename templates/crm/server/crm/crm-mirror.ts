import { assertAccess, accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";

import type {
  CrmAdapter,
  CrmFieldDefinition,
  CrmFieldStoragePolicy,
  CrmObjectDefinition,
  CrmRecord,
  CrmSyncScope,
  CrmValue,
} from "../../shared/crm-contract.js";
import { getDb, schema } from "../db/index.js";

export const CORE_HUBSPOT_OBJECTS = ["companies", "contacts", "deals"] as const;
export const CORE_SALESFORCE_OBJECTS = [
  "Account",
  "Contact",
  "Opportunity",
] as const;
export const MAX_SYNC_PAGE_SIZE = 50;
export const MAX_SYNC_PAGES = 5;

const DEFAULT_FIELDS: Record<string, string[]> = {
  companies: ["name", "domain", "industry", "city", "state", "country"],
  contacts: ["firstname", "lastname", "email", "jobtitle", "company"],
  deals: ["dealname", "amount", "dealstage", "pipeline", "closedate"],
  Account: [
    "Name",
    "Website",
    "Industry",
    "BillingCity",
    "BillingState",
    "BillingCountry",
    "OwnerId",
  ],
  Contact: ["FirstName", "LastName", "Email", "Title", "AccountId", "OwnerId"],
  Opportunity: [
    "Name",
    "Amount",
    "StageName",
    "CloseDate",
    "AccountId",
    "OwnerId",
    "Type",
  ],
};

const BINARY_OR_TRANSCRIPT_FIELD =
  /(?:attachment|audio|base64|binary|file|image|media|recording|transcript|video)/i;

const CADENCE_FIELDS: CrmFieldDefinition[] = [
  {
    name: "desiredCadenceDays",
    label: "Desired cadence days",
    valueType: "number",
    storagePolicy: "local-authoritative",
    sensitive: false,
    readable: true,
    createable: false,
    updateable: true,
    required: false,
  },
  {
    name: "lastMeaningfulInteractionAt",
    label: "Last meaningful interaction",
    valueType: "datetime",
    storagePolicy: "derived-local",
    sensitive: false,
    readable: true,
    createable: false,
    updateable: false,
    required: false,
  },
  {
    name: "nextContactAt",
    label: "Next contact",
    valueType: "datetime",
    storagePolicy: "derived-local",
    sensitive: false,
    readable: true,
    createable: false,
    updateable: false,
    required: false,
  },
];

type Ownership = {
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org";
};

export type MirrorSyncInput = {
  connectionId: string;
  objectType: string;
  scope: CrmSyncScope;
  fieldAllowList?: string[];
  allowCustomObject?: boolean;
  cursor?: string;
  pageSize?: number;
  maxPages?: number;
  ownership: Ownership;
  adapter: CrmAdapter;
};

export function isCustomHubSpotObject(objectType: string): boolean {
  return !CORE_HUBSPOT_OBJECTS.includes(
    objectType as (typeof CORE_HUBSPOT_OBJECTS)[number],
  );
}

export function resolveMirrorFields(input: {
  object: CrmObjectDefinition;
  requested: string[] | undefined;
  allowCustomObject: boolean | undefined;
}): string[] {
  const available = new Map(
    input.object.fields
      .filter((field) => field.readable)
      .map((field) => [field.name, field]),
  );
  const custom = input.object.custom;
  const requested =
    input.requested?.map((field) => field.trim()).filter(Boolean) ?? [];
  if (custom && (!input.allowCustomObject || requested.length === 0)) {
    throw new Error(
      "Custom CRM objects require allowCustomObject and an explicit field allow-list.",
    );
  }
  const candidates = requested.length
    ? requested
    : (DEFAULT_FIELDS[input.object.objectType] ?? []);
  return Array.from(new Set(candidates)).filter((fieldName) => {
    const field = available.get(fieldName);
    return Boolean(
      field && !field.sensitive && !BINARY_OR_TRANSCRIPT_FIELD.test(fieldName),
    );
  });
}

export function storagePolicyFor(
  field: CrmFieldDefinition,
  mirrored: Set<string>,
): CrmFieldStoragePolicy {
  if (field.sensitive) return "redacted";
  return mirrored.has(field.name) ? "mirrored" : "remote-only";
}

export function fieldsForPolicyDiscovery(object: CrmObjectDefinition) {
  if (object.kind !== "account" && object.kind !== "person") {
    return object.fields;
  }
  return [...object.fields, ...CADENCE_FIELDS];
}

function hasBase64Shape(value: string): boolean {
  return (
    value.length > 256 &&
    /^[A-Za-z0-9+/=\s]+$/.test(value) &&
    value.replace(/\s/g, "").length % 4 === 0
  );
}

export function safeMirroredValue(value: CrmValue, depth = 0): CrmValue | null {
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string") {
    if (
      value.length > 2_000 ||
      value.trimStart().startsWith("data:") ||
      hasBase64Shape(value)
    )
      return null;
    return value;
  }
  if (depth >= 3 || !Array.isArray(value) || value.length > 40) return null;
  const values = value.map((item) => safeMirroredValue(item, depth + 1));
  return values.every((item) => item !== null) ? (values as CrmValue) : null;
}

function fieldColumns(value: CrmValue) {
  if (typeof value === "string")
    return {
      stringValue: value,
      numberValue: null,
      booleanValue: null,
      jsonValue: null,
    };
  if (typeof value === "number")
    return {
      stringValue: null,
      numberValue: value,
      booleanValue: null,
      jsonValue: null,
    };
  if (typeof value === "boolean")
    return {
      stringValue: null,
      numberValue: null,
      booleanValue: value,
      jsonValue: null,
    };
  if (value === null)
    return {
      stringValue: null,
      numberValue: null,
      booleanValue: null,
      jsonValue: null,
    };
  const jsonValue = JSON.stringify(value);
  if (jsonValue.length > 8_000)
    throw new Error("Mirrored field value exceeds the 8,000-character limit.");
  return {
    stringValue: null,
    numberValue: null,
    booleanValue: null,
    jsonValue,
  };
}

export function crmRecordIdentityColumns(record: CrmRecord) {
  return {
    provider: record.ref.provider,
    objectType: record.ref.objectType,
    kind: record.ref.kind,
  };
}

export function crmRecordSummaryColumns(record: CrmRecord) {
  const fields = record.fields;
  const string = (...names: string[]) => {
    for (const name of names) {
      if (typeof fields[name] === "string") return fields[name];
    }
    return null;
  };
  const numeric = (...names: string[]) => {
    for (const name of names) {
      const value = fields[name];
      if (typeof value === "number") return value;
      if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value))
        return Number(value);
    }
    return null;
  };
  return {
    displayName: record.displayName.slice(0, 500),
    primaryEmail: string("email", "Email"),
    domain: string("domain", "Website"),
    stage: string("dealstage", "StageName"),
    pipelineId: string("pipeline", "RecordTypeId"),
    ownerRemoteId: string("hubspot_owner_id", "OwnerId"),
    amount: numeric("amount", "Amount"),
    closeDate: string("closedate", "CloseDate"),
    remoteRevision: record.remoteRevision ?? null,
    remoteUpdatedAt: record.remoteUpdatedAt ?? null,
    lastSyncedAt: new Date().toISOString(),
    accessScopeKey: record.accessScope.key.slice(0, 500),
    accessScopeJson: JSON.stringify(record.accessScope).slice(0, 8_000),
    tombstone: record.deleted,
    updatedAt: new Date().toISOString(),
  };
}

async function persistSchema(input: {
  connectionId: string;
  object: CrmObjectDefinition;
  mirrored: Set<string>;
  ownership: Ownership;
  capabilities: CrmAdapter["capabilities"];
}): Promise<Map<string, string>> {
  const db = getDb();
  const [existingObject] = await db
    .select({ id: schema.crmObjects.id })
    .from(schema.crmObjects)
    .where(
      and(
        eq(schema.crmObjects.connectionId, input.connectionId),
        eq(schema.crmObjects.objectType, input.object.objectType),
        accessFilter(schema.crmObjects, schema.crmObjectShares),
      ),
    )
    .limit(1);
  const now = new Date().toISOString();
  const objectValues = {
    provider: input.object.provider,
    objectType: input.object.objectType,
    kind: input.object.kind,
    label: input.object.label.slice(0, 500),
    pluralLabel: input.object.pluralLabel.slice(0, 500),
    custom: input.object.custom,
    queryable: input.object.queryable,
    searchable: input.object.searchable,
    createable: input.object.createable,
    updateable: input.object.updateable,
    deleteable: input.object.deleteable,
    capabilitiesJson: JSON.stringify(input.capabilities).slice(0, 4_000),
    updatedAt: now,
  };
  if (existingObject) {
    await assertAccess("crm-object", existingObject.id, "editor");
    await db
      .update(schema.crmObjects)
      .set(objectValues)
      .where(
        and(
          eq(schema.crmObjects.id, existingObject.id),
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
      connectionId: input.connectionId,
      ...objectValues,
      ...input.ownership,
      createdAt: now,
    });
  }

  const existingPolicies = await db
    .select({
      id: schema.crmFieldPolicies.id,
      fieldName: schema.crmFieldPolicies.fieldName,
      storagePolicy: schema.crmFieldPolicies.storagePolicy,
    })
    .from(schema.crmFieldPolicies)
    .where(
      and(
        eq(schema.crmFieldPolicies.connectionId, input.connectionId),
        eq(schema.crmFieldPolicies.objectType, input.object.objectType),
        accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
      ),
    );
  const byName = new Map(
    existingPolicies.map((policy) => [policy.fieldName, policy]),
  );
  const policyIds = new Map(
    existingPolicies.map((policy) => [policy.fieldName, policy.id]),
  );
  for (const field of fieldsForPolicyDiscovery(input.object)) {
    const existing = byName.get(field.name);
    const discoveredPolicy =
      field.storagePolicy === "local-authoritative" ||
      field.storagePolicy === "derived-local"
        ? field.storagePolicy
        : storagePolicyFor(field, input.mirrored);
    const storagePolicy =
      existing?.storagePolicy === "local-authoritative"
        ? "local-authoritative"
        : discoveredPolicy;
    const values = {
      label: field.label.slice(0, 500),
      valueType: field.valueType,
      storagePolicy,
      sensitive: field.sensitive,
      readable: field.readable,
      createable: field.createable,
      updateable: field.updateable,
      required: field.required,
      metadataJson: JSON.stringify({
        options: field.options,
        referencedObjectType: field.referencedObjectType,
      }).slice(0, 8_000),
      updatedAt: now,
    };
    if (existing) {
      await assertAccess("crm-field-policy", existing.id, "editor");
      await db
        .update(schema.crmFieldPolicies)
        .set(values)
        .where(
          and(
            eq(schema.crmFieldPolicies.id, existing.id),
            accessFilter(
              schema.crmFieldPolicies,
              schema.crmFieldPolicyShares,
              undefined,
              "editor",
            ),
          ),
        );
    } else {
      const id = crypto.randomUUID();
      await db.insert(schema.crmFieldPolicies).values({
        id,
        connectionId: input.connectionId,
        objectType: input.object.objectType,
        fieldName: field.name,
        ...values,
        ...input.ownership,
        createdAt: now,
      });
      policyIds.set(field.name, id);
    }
  }
  return policyIds;
}

async function persistPage(input: {
  connectionId: string;
  provider: string;
  objectType: string;
  page: Awaited<ReturnType<CrmAdapter["syncPage"]>>;
  fields: Map<string, CrmFieldDefinition>;
  fieldPolicyIds: Map<string, string>;
  mirrored: Set<string>;
  ownership: Ownership;
}) {
  const db = getDb();
  const remoteIds = input.page.records.map((record) => record.ref.remoteId);
  if (remoteIds.length === 0)
    return { recordsUpserted: 0, tombstonesApplied: 0, rejectedFields: 0 };
  return db.transaction(async (tx) => {
    const existingRecords = await tx
      .select({
        id: schema.crmRecords.id,
        remoteId: schema.crmRecords.remoteId,
        ownerEmail: schema.crmRecords.ownerEmail,
        orgId: schema.crmRecords.orgId,
        visibility: schema.crmRecords.visibility,
      })
      .from(schema.crmRecords)
      .where(
        and(
          eq(schema.crmRecords.connectionId, input.connectionId),
          eq(schema.crmRecords.provider, input.provider),
          eq(schema.crmRecords.objectType, input.objectType),
          inArray(schema.crmRecords.remoteId, remoteIds),
          accessFilter(schema.crmRecords, schema.crmRecordShares),
        ),
      );
    const recordsByRemoteId = new Map(
      existingRecords.map((record) => [record.remoteId, record]),
    );
    const recordIds = existingRecords.map((record) => record.id);
    const existingFields = recordIds.length
      ? await tx
          .select({
            id: schema.crmRecordFields.id,
            recordId: schema.crmRecordFields.recordId,
            fieldName: schema.crmRecordFields.fieldName,
            storagePolicy: schema.crmRecordFields.storagePolicy,
          })
          .from(schema.crmRecordFields)
          .where(
            and(
              inArray(schema.crmRecordFields.recordId, recordIds),
              accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
            ),
          )
      : [];
    const fieldsByRecord = new Map(
      existingFields.map((field) => [
        `${field.recordId}:${field.fieldName}`,
        field,
      ]),
    );
    let recordsUpserted = 0;
    let tombstonesApplied = 0;
    let rejectedFields = 0;
    for (const remoteRecord of input.page.records) {
      const existing = recordsByRemoteId.get(remoteRecord.ref.remoteId);
      const values = crmRecordSummaryColumns(remoteRecord);
      const identity = crmRecordIdentityColumns(remoteRecord);
      const recordId = existing?.id ?? crypto.randomUUID();
      const ownership = existing
        ? {
            ownerEmail: existing.ownerEmail,
            orgId: existing.orgId,
            visibility: existing.visibility,
          }
        : input.ownership;
      if (existing) {
        await tx
          .update(schema.crmRecords)
          .set({
            ...values,
            ...identity,
          })
          .where(
            and(
              eq(schema.crmRecords.id, existing.id),
              accessFilter(
                schema.crmRecords,
                schema.crmRecordShares,
                undefined,
                "editor",
              ),
            ),
          );
      } else {
        await tx.insert(schema.crmRecords).values({
          id: recordId,
          connectionId: input.connectionId,
          ...identity,
          remoteId: remoteRecord.ref.remoteId,
          ...values,
          ...ownership,
          createdAt: new Date().toISOString(),
        });
      }
      recordsUpserted += 1;
      if (remoteRecord.deleted) tombstonesApplied += 1;
      for (const [fieldName, rawValue] of Object.entries(remoteRecord.fields)) {
        if (
          !input.mirrored.has(fieldName) ||
          BINARY_OR_TRANSCRIPT_FIELD.test(fieldName)
        ) {
          rejectedFields += 1;
          continue;
        }
        const definition = input.fields.get(fieldName);
        if (!definition || definition.sensitive) {
          rejectedFields += 1;
          continue;
        }
        const value = safeMirroredValue(rawValue);
        if (value === null && rawValue !== null) {
          rejectedFields += 1;
          continue;
        }
        const provenance = remoteRecord.provenance.filter(
          (item) => item.fieldName === fieldName,
        );
        const fieldValues = {
          fieldPolicyId: input.fieldPolicyIds.get(fieldName) ?? null,
          valueType: definition.valueType,
          storagePolicy: "mirrored" as const,
          ...fieldColumns(value),
          provenanceJson: JSON.stringify(provenance).slice(0, 4_000),
          accessScopeKey: remoteRecord.accessScope.key.slice(0, 500),
          accessScopeJson: JSON.stringify(remoteRecord.accessScope).slice(
            0,
            8_000,
          ),
          remoteRevision: remoteRecord.remoteRevision ?? null,
          updatedAt: new Date().toISOString(),
        };
        const existingField = fieldsByRecord.get(`${recordId}:${fieldName}`);
        if (existingField?.storagePolicy === "local-authoritative") continue;
        if (existingField) {
          await tx
            .update(schema.crmRecordFields)
            .set(fieldValues)
            .where(
              and(
                eq(schema.crmRecordFields.id, existingField.id),
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
            recordId,
            fieldName,
            ...fieldValues,
            ...ownership,
            createdAt: new Date().toISOString(),
          });
        }
      }
    }
    return { recordsUpserted, tombstonesApplied, rejectedFields };
  });
}

export async function syncCrmMirror(input: MirrorSyncInput) {
  const object = await input.adapter.describeObject(input.objectType);
  const fields = resolveMirrorFields({
    object,
    requested: input.fieldAllowList,
    allowCustomObject: input.allowCustomObject,
  });
  if (fields.length === 0)
    throw new Error(
      "No readable, safe fields are eligible for thin mirroring.",
    );
  const mirrored = new Set(fields);
  const fieldPolicyIds = await persistSchema({
    connectionId: input.connectionId,
    object,
    mirrored,
    ownership: input.ownership,
    capabilities: input.adapter.capabilities,
  });
  const db = getDb();
  const startedAt = new Date().toISOString();
  const syncRunId = crypto.randomUUID();
  await db.insert(schema.crmSyncRuns).values({
    id: syncRunId,
    connectionId: input.connectionId,
    status: "running",
    scopeJson: JSON.stringify(input.scope).slice(0, 8_000),
    cursor: input.cursor ?? null,
    startedAt,
    ...input.ownership,
    createdAt: startedAt,
    updatedAt: startedAt,
  });
  let cursor = input.cursor;
  let complete = false;
  let recordsUpserted = 0;
  let tombstonesApplied = 0;
  let rejectedFields = 0;
  const pages = Math.min(input.maxPages ?? MAX_SYNC_PAGES, MAX_SYNC_PAGES);
  const pageSize = Math.min(
    input.pageSize ?? MAX_SYNC_PAGE_SIZE,
    MAX_SYNC_PAGE_SIZE,
  );
  try {
    for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
      const page = await input.adapter.syncPage({
        scope: input.scope,
        fieldAllowList: fields,
        cursor,
        limit: pageSize,
      });
      const result = await persistPage({
        connectionId: input.connectionId,
        provider: object.provider,
        objectType: object.objectType,
        page,
        fields: new Map(object.fields.map((field) => [field.name, field])),
        fieldPolicyIds,
        mirrored,
        ownership: input.ownership,
      });
      recordsUpserted += result.recordsUpserted;
      tombstonesApplied += result.tombstonesApplied;
      rejectedFields += result.rejectedFields;
      cursor = page.nextCursor;
      complete = page.complete;
      if (complete || !cursor) break;
    }
    const status = complete ? "success" : "partial";
    const completedAt = new Date().toISOString();
    await db
      .update(schema.crmSyncRuns)
      .set({
        status,
        cursor: cursor ?? null,
        recordsUpserted,
        tombstonesApplied,
        relationshipsUpserted: 0,
        completedAt,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(schema.crmSyncRuns.id, syncRunId),
          accessFilter(
            schema.crmSyncRuns,
            schema.crmSyncRunShares,
            undefined,
            "editor",
          ),
        ),
      );
    return {
      syncRunId,
      status,
      cursor,
      complete,
      recordsUpserted,
      tombstonesApplied,
      relationshipsUpserted: 0,
      rejectedFields,
      fieldAllowList: fields,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 1_000)
        : "CRM sync failed.";
    await db
      .update(schema.crmSyncRuns)
      .set({
        status: "failed",
        cursor: cursor ?? null,
        recordsUpserted,
        tombstonesApplied,
        error: message,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(schema.crmSyncRuns.id, syncRunId),
          accessFilter(
            schema.crmSyncRuns,
            schema.crmSyncRunShares,
            undefined,
            "editor",
          ),
        ),
      );
    throw error;
  }
}
