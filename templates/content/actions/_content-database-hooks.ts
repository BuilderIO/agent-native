import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import {
  upsertWorkflowSubscription,
  workflowSubscriptions,
} from "@agent-native/core/workflow";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { contentMutationTriggerCoverage } from "../server/db/mutation-certification-manifest.js";
import {
  isBlocksPropertyType,
  isComputedPropertyType,
  parsePropertyOptions,
  type DocumentPropertyType,
} from "../shared/properties.js";
import { nanoid, normalizedValueJson } from "./_property-utils.js";

export const contentHookTriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("item_created"),
  }),
  z.object({
    kind: z.literal("item_submitted"),
  }),
  z.object({
    kind: z.literal("property_changed"),
    propertyId: z.string().min(1),
    fromOptionId: z.string().min(1).nullable().optional(),
    toOptionId: z.string().min(1).nullable().optional(),
  }),
  z.object({
    kind: z.literal("builder_publication_confirmed"),
    publicationAction: z.enum(["publish", "unpublish"]).nullable().optional(),
  }),
]);

const secretKeyNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{1,127}$/);

export const contentHookEffectSchema = z.discriminatedUnion("kind", [
  z.object({
    version: z.literal(1).default(1),
    kind: z.literal("notify"),
    recipientPersonPropertyId: z.string().min(1),
    message: z.string().max(2_000).optional(),
  }),
  z.object({
    version: z.literal(1).default(1),
    kind: z.literal("team_slack"),
    webhookKey: secretKeyNameSchema,
    title: z.string().trim().min(1).max(100).optional(),
    message: z.string().max(2_000).optional(),
  }),
  z.object({
    version: z.literal(1).default(1),
    kind: z.literal("webhook"),
    urlKey: secretKeyNameSchema,
    signatureKey: secretKeyNameSchema,
    title: z.string().trim().min(1).max(100).optional(),
    message: z.string().max(2_000).optional(),
  }),
  z.object({
    version: z.literal(1).default(1),
    kind: z.literal("set_property"),
    propertyId: z.string().min(1),
    value: z.unknown(),
  }),
]);
export const contentHookEffectsSchema = z
  .array(contentHookEffectSchema)
  .min(1)
  .max(10);

const contentHookValueConditionSchema = z.object({
  propertyId: z.string().min(1),
  operator: z.enum(["equals", "not_equals", "contains"]),
  value: z.unknown().refine((value) => value !== undefined, {
    message: "A comparison value is required.",
  }),
});

const contentHookEmptyConditionSchema = z
  .object({
    propertyId: z.string().min(1),
    operator: z.enum(["is_empty", "is_not_empty"]),
  })
  .strict();

export const contentHookConditionSchema = z.union([
  contentHookValueConditionSchema,
  contentHookEmptyConditionSchema,
]);
export const contentHookConditionsSchema = z.object({
  mode: z.enum(["all", "any"]),
  clauses: z.array(contentHookConditionSchema).min(1).max(10),
});

export const contentHookTimingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("immediate") }),
  z.object({
    kind: z.enum(["delayed", "debounced", "escalation"]),
    delayMinutes: z.number().int().min(1).max(10_080),
  }),
]);

export type ContentHookTrigger = z.infer<typeof contentHookTriggerSchema>;
export type ContentHookEffect = z.infer<typeof contentHookEffectSchema>;
export type ContentHookTiming = z.infer<typeof contentHookTimingSchema>;
export type ContentHookCondition = z.infer<typeof contentHookConditionSchema>;
export type ContentHookConditions = z.infer<typeof contentHookConditionsSchema>;
export type ContentHookTriggerKind = ContentHookTrigger["kind"];

export interface ContentHookTriggerAvailability {
  kind: ContentHookTriggerKind;
  available: boolean;
  reason?: string;
}

const itemCreatedCoverage = contentMutationTriggerCoverage("item_created");
const itemSubmittedCoverage = contentMutationTriggerCoverage("item_submitted");
const propertyChangedCoverage =
  contentMutationTriggerCoverage("property_changed");

export const contentHookTriggerAvailability = [
  {
    kind: "item_created",
    available: itemCreatedCoverage.available,
    ...(!itemCreatedCoverage.available
      ? {
          reason: `Item creation is missing certified adapters for: ${itemCreatedCoverage.missingPaths.join(", ")}.`,
        }
      : {}),
  },
  {
    kind: "item_submitted",
    available: itemSubmittedCoverage.available,
    ...(!itemSubmittedCoverage.available
      ? {
          reason: `Item submission is missing certified adapters for: ${itemSubmittedCoverage.missingPaths.join(", ")}.`,
        }
      : {}),
  },
  {
    kind: "property_changed",
    available: propertyChangedCoverage.available,
    ...(!propertyChangedCoverage.available
      ? {
          reason: `Editable field changes are missing certified adapters for: ${propertyChangedCoverage.missingPaths.join(", ")}.`,
        }
      : {}),
  },
  { kind: "builder_publication_confirmed", available: true },
] as const satisfies readonly ContentHookTriggerAvailability[];

export function contentHookTriggerPolicy(kind: ContentHookTriggerKind) {
  return contentHookTriggerAvailability.find((entry) => entry.kind === kind)!;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Content hook effect: ${JSON.stringify(value)}`);
}

function effectPropertyIds(effect: ContentHookEffect): string[] {
  switch (effect.kind) {
    case "notify":
      return [effect.recipientPersonPropertyId];
    case "set_property":
      return [effect.propertyId];
    case "team_slack":
    case "webhook":
      return [];
    default:
      return assertNever(effect);
  }
}

export interface ContentHookConfig {
  domain: "content";
  resourceId: string;
  databaseId: string;
  name: string;
  trigger: ContentHookTrigger;
  conditions?: ContentHookConditions;
  effects: ContentHookEffect[];
  timing: ContentHookTiming;
  createdBy: string;
  deletedAt?: number;
}

export interface ContentDefaultPersonHookConfig {
  domain: "content";
  resourceId: string;
  system: "default_person_notifications";
  databaseId: string;
  name: string;
}

export type ContentWorkflowHookConfig =
  | ContentHookConfig
  | ContentDefaultPersonHookConfig;

export interface ContentDatabaseHook {
  id: string;
  databaseId: string;
  name: string;
  enabled: boolean;
  trigger: ContentHookTrigger;
  conditions?: ContentHookConditions;
  effects: ContentHookEffect[];
  timing: ContentHookTiming;
  /** Compatibility alias for older clients that authored one effect. */
  effect: ContentHookEffect;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

function eventPatternForTrigger(trigger: ContentHookTrigger) {
  if (trigger.kind === "item_created") return "content.database.item.created";
  if (trigger.kind === "item_submitted") {
    return "content.database.item.submitted";
  }
  if (trigger.kind === "builder_publication_confirmed") {
    return "content.builder.publication.confirmed";
  }
  return "content.database.property.changed";
}

function parseConfig(value: string): ContentWorkflowHookConfig | null {
  try {
    const parsed = JSON.parse(value) as Partial<
      ContentHookConfig & ContentDefaultPersonHookConfig
    > & { effect?: unknown };
    if (
      parsed.domain === "content" &&
      parsed.system === "default_person_notifications" &&
      typeof parsed.databaseId === "string" &&
      typeof parsed.name === "string"
    ) {
      return {
        domain: "content",
        resourceId: parsed.databaseId,
        system: "default_person_notifications",
        databaseId: parsed.databaseId,
        name: parsed.name,
      };
    }
    if (
      parsed.domain !== "content" ||
      typeof parsed.databaseId !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.createdBy !== "string"
    ) {
      return null;
    }
    const trigger = contentHookTriggerSchema.safeParse(parsed.trigger);
    const effects = contentHookEffectsSchema.safeParse(
      Array.isArray(parsed.effects)
        ? parsed.effects
        : parsed.effect
          ? [parsed.effect]
          : [],
    );
    const timing = contentHookTimingSchema.safeParse(
      parsed.timing ?? { kind: "immediate" },
    );
    const conditions = contentHookConditionsSchema.safeParse(parsed.conditions);
    if (
      !trigger.success ||
      !effects.success ||
      !timing.success ||
      (parsed.conditions !== undefined && !conditions.success)
    ) {
      return null;
    }
    return {
      domain: "content",
      resourceId: parsed.databaseId,
      databaseId: parsed.databaseId,
      name: parsed.name,
      trigger: trigger.data,
      ...(conditions.success ? { conditions: conditions.data } : {}),
      effects: effects.data,
      timing: timing.data,
      createdBy: parsed.createdBy,
      ...(typeof parsed.deletedAt === "number"
        ? { deletedAt: parsed.deletedAt }
        : {}),
    };
  } catch {
    return null;
  }
}

export async function requireContentDatabaseAccess(
  databaseId: string,
  role: "viewer" | "admin",
) {
  const db = getDb();
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.id, databaseId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
  if (!database) throw new Error(`Database "${databaseId}" not found.`);
  await assertAccess("document", database.documentId, role);
  return database;
}

export async function requireContentDatabaseOwner(databaseId: string) {
  const database = await requireContentDatabaseAccess(databaseId, "admin");
  if (getRequestUserEmail() !== database.ownerEmail) {
    throw Object.assign(
      new Error("Only the database owner can manage shared hooks and policy."),
      { statusCode: 403 },
    );
  }
  return database;
}

export function assertContentDatabaseSchemaUnlocked(database: {
  ownerEmail: string;
  viewConfigJson?: string | null;
}) {
  let schemaLocked = false;
  try {
    schemaLocked =
      database.viewConfigJson != null &&
      (JSON.parse(database.viewConfigJson) as { schemaLocked?: unknown })
        .schemaLocked === true;
  } catch {
    schemaLocked = false;
  }
  if (schemaLocked && getRequestUserEmail() !== database.ownerEmail) {
    throw Object.assign(
      new Error("This database is locked. Only its owner can change schema."),
      { statusCode: 403 },
    );
  }
}

export async function contentHookHasCurrentAuthority(args: {
  databaseId: string;
  ownerEmail: string;
}) {
  const [database] = await getDb()
    .select({ ownerEmail: schema.contentDatabases.ownerEmail })
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.id, args.databaseId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
  return database?.ownerEmail === args.ownerEmail;
}

async function validateStableHookReferences(args: {
  databaseId: string;
  trigger: ContentHookTrigger;
  conditions?: ContentHookConditions;
  effects: ContentHookEffect[];
}) {
  const db = getDb();
  const propertyIds = new Set<string>([
    ...args.effects.flatMap(effectPropertyIds),
    ...(args.trigger.kind === "property_changed"
      ? [args.trigger.propertyId]
      : []),
    ...(args.conditions?.clauses.map((condition) => condition.propertyId) ??
      []),
  ]);
  const definitions = await db
    .select()
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, args.databaseId));
  const byId = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  for (const propertyId of propertyIds) {
    if (!byId.has(propertyId)) {
      throw new Error(
        `Property "${propertyId}" does not belong to this database.`,
      );
    }
  }
  for (const effect of args.effects) {
    switch (effect.kind) {
      case "notify": {
        const recipient = byId.get(effect.recipientPersonPropertyId);
        if (recipient?.type !== "person") {
          throw new Error(
            "Notification recipients must come from a Person property.",
          );
        }
        break;
      }
      case "set_property": {
        const definition = byId.get(effect.propertyId);
        const type = definition?.type as DocumentPropertyType | undefined;
        if (
          !definition ||
          !type ||
          isComputedPropertyType(type) ||
          isBlocksPropertyType(type)
        ) {
          throw new Error(
            "Deterministic hooks may set only editable, non-Blocks properties.",
          );
        }
        const normalized = JSON.parse(normalizedValueJson(type, effect.value));
        if (type === "select" || type === "status" || type === "multi_select") {
          const optionIds = new Set(
            (parsePropertyOptions(definition.optionsJson).options ?? []).map(
              (option) => option.id,
            ),
          );
          const selectedIds = Array.isArray(normalized)
            ? normalized
            : normalized == null
              ? []
              : [normalized];
          if (
            selectedIds.some(
              (optionId) =>
                typeof optionId !== "string" || !optionIds.has(optionId),
            )
          ) {
            throw new Error(
              `The set_property value must use stable option IDs from property "${effect.propertyId}".`,
            );
          }
        }
        break;
      }
      case "team_slack":
      case "webhook":
        break;
      default:
        assertNever(effect);
    }
  }
  for (const condition of args.conditions?.clauses ?? []) {
    const definition = byId.get(condition.propertyId);
    const type = definition?.type as DocumentPropertyType | undefined;
    if (
      !definition ||
      !type ||
      isComputedPropertyType(type) ||
      isBlocksPropertyType(type)
    ) {
      throw new Error(
        "Rule conditions may inspect only editable, non-Blocks properties.",
      );
    }
  }
  if (args.trigger.kind !== "property_changed") return;
  const property = byId.get(args.trigger.propertyId)!;
  const propertyType = property.type as DocumentPropertyType;
  if (
    isComputedPropertyType(propertyType) ||
    isBlocksPropertyType(propertyType)
  ) {
    throw new Error(
      "Rules can observe only editable, non-Blocks property changes.",
    );
  }
  const optionIds = new Set(
    (parsePropertyOptions(property.optionsJson).options ?? []).map(
      (option) => option.id,
    ),
  );
  for (const optionId of [args.trigger.fromOptionId, args.trigger.toOptionId]) {
    if (optionId && !optionIds.has(optionId)) {
      throw new Error(
        `Option "${optionId}" does not belong to property "${property.id}".`,
      );
    }
  }
}

export async function listContentDatabaseHooks(databaseId: string) {
  const db = getDb();
  const [database] = await db
    .select({ ownerEmail: schema.contentDatabases.ownerEmail })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  if (!database) return [];
  const rows = await db
    .select()
    .from(workflowSubscriptions)
    .where(
      and(
        eq(workflowSubscriptions.kind, "deterministic"),
        eq(workflowSubscriptions.ownerEmail, database.ownerEmail),
      ),
    );
  return rows.flatMap((row) => {
    const config = parseConfig(row.config);
    if (
      !config ||
      "system" in config ||
      config.deletedAt ||
      config.databaseId !== databaseId
    ) {
      return [];
    }
    return [
      {
        id: row.id,
        databaseId,
        name: config.name,
        enabled: row.enabled,
        trigger: config.trigger,
        conditions: config.conditions,
        effects: config.effects,
        timing: config.timing,
        effect: config.effects[0],
        createdBy: config.createdBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      } satisfies ContentDatabaseHook,
    ];
  });
}

export function contentDefaultPersonSubscriptionId(databaseId: string) {
  return `content-default-person:${databaseId}`;
}

export async function getContentDatabaseHook(
  databaseId: string,
  hookId: string,
) {
  return (await listContentDatabaseHooks(databaseId)).find(
    (hook) => hook.id === hookId,
  );
}

export async function saveContentDatabaseHook(args: {
  id?: string;
  databaseId: string;
  name: string;
  enabled: boolean;
  trigger: ContentHookTrigger;
  conditions?: ContentHookConditions;
  effects: ContentHookEffect[];
  timing?: ContentHookTiming;
  createdBy?: string;
}) {
  const database = await requireContentDatabaseOwner(args.databaseId);
  const triggerPolicy = contentHookTriggerPolicy(args.trigger.kind);
  if (args.enabled && !triggerPolicy.available) {
    throw new Error(
      `${args.trigger.kind} hooks cannot be enabled: ${triggerPolicy.reason}`,
    );
  }
  await validateStableHookReferences(args);
  const id = args.id ?? nanoid();
  const createdBy =
    args.createdBy ?? getRequestUserEmail() ?? database.ownerEmail;
  await upsertWorkflowSubscription({
    id,
    kind: "deterministic",
    eventPattern: eventPatternForTrigger(args.trigger),
    ownerEmail: database.ownerEmail,
    orgId: database.orgId,
    enabled: args.enabled,
    config: {
      domain: "content",
      resourceId: args.databaseId,
      databaseId: args.databaseId,
      name: args.name,
      trigger: args.trigger,
      ...(args.conditions ? { conditions: args.conditions } : {}),
      effects: args.effects,
      timing: args.timing ?? { kind: "immediate" },
      createdBy,
    },
  });
  const hook = await getContentDatabaseHook(args.databaseId, id);
  if (!hook) throw new Error("The hook was saved but could not be reloaded.");
  return hook;
}

export async function deleteContentDatabaseHook(
  databaseId: string,
  hookId: string,
) {
  await requireContentDatabaseOwner(databaseId);
  const hook = await getContentDatabaseHook(databaseId, hookId);
  if (!hook) throw new Error(`Hook "${hookId}" not found.`);
  const database = await requireContentDatabaseAccess(databaseId, "admin");
  await upsertWorkflowSubscription({
    id: hook.id,
    kind: "deterministic",
    eventPattern: eventPatternForTrigger(hook.trigger),
    ownerEmail: database.ownerEmail,
    orgId: database.orgId,
    enabled: false,
    config: {
      domain: "content",
      resourceId: databaseId,
      databaseId,
      name: hook.name,
      trigger: hook.trigger,
      ...(hook.conditions ? { conditions: hook.conditions } : {}),
      effects: hook.effects,
      timing: hook.timing,
      createdBy: hook.createdBy,
      deletedAt: Date.now(),
    },
  });
}

export function contentHookConfigFromJson(value: string) {
  return parseConfig(value);
}
