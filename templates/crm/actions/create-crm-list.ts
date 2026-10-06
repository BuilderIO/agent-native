import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  legacyValueTypeFor,
  type CrmAttributeType,
} from "../shared/crm-attributes.js";
import { requireCrmScope } from "./_crm-action-utils.js";
import {
  CrmListError,
  crmApiSlug,
  loadCrmObjectAttributes,
  uniqueCrmListSlug,
  type CrmObjectAttribute,
} from "./_crm-list-utils.js";

const DEFAULT_STAGE_OPTIONS = [
  { value: "new", title: "New" },
  { value: "in-progress", title: "In Progress" },
  { value: "won", title: "Won", celebrate: true },
  { value: "lost", title: "Lost" },
] as const;

const DEFAULT_CURRENCY_CONFIG = JSON.stringify({ currency: { code: "USD" } });

interface SeedOption {
  value: string;
  title: string;
  color: string | null;
  position: number;
  targetDays: number | null;
  celebrate: boolean;
}

interface ListAttributeSeed {
  id: string;
  apiSlug: string;
  label: string;
  description: string;
  attributeType: CrmAttributeType;
  configJson: string;
  position: number;
  options: SeedOption[];
}

async function resolveConnectionId(
  db: ReturnType<typeof getDb>,
  connectionId: string | undefined,
): Promise<string> {
  const rows = await db
    .select({ id: schema.crmConnections.id })
    .from(schema.crmConnections)
    .where(
      and(
        ...(connectionId ? [eq(schema.crmConnections.id, connectionId)] : []),
        accessFilter(
          schema.crmConnections,
          schema.crmConnectionShares,
          undefined,
          "editor",
        ),
      ),
    )
    .limit(connectionId ? 1 : 2);
  if (!rows.length) {
    throw new CrmListError(
      "crm-connection-unavailable",
      connectionId
        ? "The selected CRM connection is unavailable or you do not have editor access."
        : "Configure a CRM before creating a list.",
    );
  }
  if (!connectionId && rows.length > 1) {
    throw new CrmListError(
      "crm-connection-ambiguous",
      "More than one CRM connection is available. Provide connectionId to choose one.",
    );
  }
  return rows[0]!.id;
}

async function loadSourceOptions(
  db: ReturnType<typeof getDb>,
  attributeId: string,
): Promise<SeedOption[]> {
  const rows = await db
    .select({
      value: schema.crmAttributeOptions.value,
      title: schema.crmAttributeOptions.title,
      color: schema.crmAttributeOptions.color,
      position: schema.crmAttributeOptions.position,
      targetDays: schema.crmAttributeOptions.targetDays,
      celebrate: schema.crmAttributeOptions.celebrate,
    })
    .from(schema.crmAttributeOptions)
    .where(
      and(
        eq(schema.crmAttributeOptions.attributeId, attributeId),
        eq(schema.crmAttributeOptions.archived, false),
        accessFilter(
          schema.crmAttributeOptions,
          schema.crmAttributeOptionShares,
        ),
      ),
    );
  return rows.sort(
    (a, b) => a.position - b.position || a.value.localeCompare(b.value),
  );
}

function seedDescription(
  listName: string,
  objectType: string,
  source: CrmObjectAttribute | null,
): string {
  return source
    ? `The list "${listName}" owns this value. Each entry starts from the ${objectType} record's ${source.label} when the record is added, and changes independently after that — editing it never writes the record.`
    : `The list "${listName}" owns this value. It starts empty and is never written back to the ${objectType} record.`;
}

export default defineAction({
  description:
    "Create a CRM list — a workflow overlay over one object type, with its own entry attributes. Lists and their entries are local-authoritative on every backend, including HubSpot and Salesforce, so a pipeline never needs a provider write. Unless seedAttributes is false, the list is seeded with its own Stage (status, with the parent object's stage options when it has any), an amount (currency), and the parent object's date attribute, so a new board has columns and a summable total immediately. A seeded attribute is a COPY of the object's shape, not a link to it: each entry's first value is copied from the record once when the record is added and never re-synced.",
  schema: z.object({
    connectionId: z.string().trim().min(1).max(128).optional(),
    name: z.string().trim().min(1).max(120),
    parentObjectType: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe(
        "Object type whose records may be added, e.g. accounts, people, opportunities.",
      ),
    description: z.string().trim().max(500).optional(),
    position: z.number().int().min(0).max(100_000).optional(),
    seedAttributes: z
      .boolean()
      .default(true)
      .describe(
        "Seed the list's own stage, amount, and date attributes from the parent object. False creates a list with no attributes at all — its board has no columns until you add a status attribute.",
      ),
  }),
  audit: {
    target: (_args, result) => {
      const list = result as {
        id: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-list",
        id: list.id,
        ownerEmail: list.ownerEmail,
        orgId: list.orgId,
        visibility: list.visibility,
      };
    },
    summary: (args) => `Created CRM list ${args.name}`,
  },
  run: async (args, ctx?: ActionRunContext) => {
    const ownership = requireCrmScope(ctx);
    const db = getDb();
    const connectionId = await resolveConnectionId(db, args.connectionId);
    const apiSlug = await uniqueCrmListSlug(
      db,
      connectionId,
      crmApiSlug(args.name),
    );
    const listId = crypto.randomUUID();
    const now = new Date().toISOString();

    const sources = args.seedAttributes
      ? await loadCrmObjectAttributes(db, connectionId, args.parentObjectType)
      : [];
    const sourceOf = (type: CrmAttributeType): CrmObjectAttribute | null =>
      sources.find((source) => source.attributeType === type) ?? null;
    const statusSource = sourceOf("status");
    const currencySource = sourceOf("currency");
    const dateSource = sourceOf("date");

    const stageOptions = statusSource
      ? await loadSourceOptions(db, statusSource.id)
      : [];

    const seeds: ListAttributeSeed[] = args.seedAttributes
      ? [
          {
            id: crypto.randomUUID(),
            apiSlug: statusSource?.apiSlug ?? "stage",
            label: `${args.name} Stage`,
            description: seedDescription(
              args.name,
              args.parentObjectType,
              statusSource,
            ),
            attributeType: "status",
            configJson: statusSource?.configJson ?? "{}",
            position: 0,
            options: stageOptions.length
              ? stageOptions
              : DEFAULT_STAGE_OPTIONS.map((option, index) => ({
                  value: option.value,
                  title: option.title,
                  color: null,
                  position: index,
                  targetDays: null,
                  celebrate: "celebrate" in option ? option.celebrate : false,
                })),
          },
          {
            id: crypto.randomUUID(),
            apiSlug: currencySource?.apiSlug ?? "amount",
            label: currencySource?.label ?? "Amount",
            description: seedDescription(
              args.name,
              args.parentObjectType,
              currencySource,
            ),
            attributeType: "currency",
            configJson: currencySource?.configJson ?? DEFAULT_CURRENCY_CONFIG,
            position: 1,
            options: [],
          },
          ...(dateSource
            ? [
                {
                  id: crypto.randomUUID(),
                  apiSlug: dateSource.apiSlug,
                  label: dateSource.label,
                  description: seedDescription(
                    args.name,
                    args.parentObjectType,
                    dateSource,
                  ),
                  attributeType: "date" as const,
                  configJson: dateSource.configJson,
                  position: 2,
                  options: [],
                },
              ]
            : []),
        ]
      : [];

    const claimed = new Set<string>();
    const attributes = seeds.filter((seed) => {
      if (claimed.has(seed.apiSlug)) return false;
      claimed.add(seed.apiSlug);
      return true;
    });
    const stageAttributeId =
      attributes.find((seed) => seed.attributeType === "status")?.id ?? null;

    await db.transaction(async (tx) => {
      await tx.insert(schema.crmLists).values({
        id: listId,
        connectionId,
        name: args.name,
        apiSlug,
        parentObjectType: args.parentObjectType,
        description: args.description ?? "",
        defaultViewId: null,
        archived: false,
        position: args.position ?? 0,
        source: "local",
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });

      if (!attributes.length) return;

      await tx.insert(schema.crmFieldPolicies).values(
        attributes.map((seed) => ({
          id: seed.id,
          connectionId,
          objectType: listId,
          fieldName: seed.apiSlug,
          label: seed.label,
          description: seed.description,
          valueType: legacyValueTypeFor(seed.attributeType, false),
          storagePolicy: "local-authoritative" as const,
          sensitive: false,
          readable: true,
          createable: true,
          updateable: true,
          required: false,
          attributeType: seed.attributeType,
          target: "list" as const,
          targetId: listId,
          apiSlug: seed.apiSlug,
          configJson: seed.configJson,
          multi: false,
          authority: "local-authoritative" as const,
          historyTracked: true,
          uniqueValue: false,
          archived: false,
          position: seed.position,
          ...ownership,
          createdAt: now,
          updatedAt: now,
        })),
      );

      const options = attributes.flatMap((seed) =>
        seed.options.map((option, index) => ({
          id: crypto.randomUUID(),
          attributeId: seed.id,
          value: option.value,
          title: option.title,
          color: option.color,
          position: index,
          archived: false,
          targetDays: option.targetDays,
          celebrate: option.celebrate,
          ...ownership,
          createdAt: now,
          updatedAt: now,
        })),
      );
      if (options.length)
        await tx.insert(schema.crmAttributeOptions).values(options);
    });

    const [list] = await db
      .select()
      .from(schema.crmLists)
      .where(
        and(
          eq(schema.crmLists.id, listId),
          accessFilter(schema.crmLists, schema.crmListShares),
        ),
      )
      .limit(1);
    if (!list) {
      throw new Error("CRM list could not be verified after creation.");
    }
    return {
      ...list,
      stageAttributeId,
      seededAttributes: attributes.map((seed) => ({
        id: seed.id,
        apiSlug: seed.apiSlug,
        label: seed.label,
        attributeType: seed.attributeType,
        seededFrom:
          sources.find((source) => source.apiSlug === seed.apiSlug)?.apiSlug ??
          null,
      })),
    };
  },
});
