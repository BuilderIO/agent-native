import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { isBlockedExtensionUrlWithDns } from "@agent-native/core/extensions/url-safety";
import { deleteAppSecret, writeAppSecret } from "@agent-native/core/secrets";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  CONTENT_WEBHOOK_SECRET_PREFIX,
  generateContentWebhookSecret,
} from "../server/lib/content-webhook-signature.js";
import {
  CONTENT_WEBHOOK_EVENT_TYPES,
  resolveContentWebhookScope,
  serializeContentWebhook,
  type ContentWebhookScope,
} from "./_content-webhooks.js";
import { nanoid } from "./_property-utils.js";

const MAX_WEBHOOKS_PER_SCOPE = 10;

async function assertPropertiesInScope(
  scope: ContentWebhookScope,
  propertyIds: string[],
) {
  if (!propertyIds.length) return;
  const db = getDb();
  const databaseIds =
    scope.scopeType === "database"
      ? [scope.scopeId]
      : (
          await db
            .select({ databaseId: schema.contentDatabaseItems.databaseId })
            .from(schema.contentDatabaseItems)
            .where(eq(schema.contentDatabaseItems.documentId, scope.scopeId))
        ).map((membership) => membership.databaseId);
  const found = databaseIds.length
    ? await db
        .select({ id: schema.documentPropertyDefinitions.id })
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            inArray(schema.documentPropertyDefinitions.id, propertyIds),
            inArray(schema.documentPropertyDefinitions.databaseId, databaseIds),
          ),
        )
    : [];
  const known = new Set(found.map((row) => row.id));
  const missing = propertyIds.filter((id) => !known.has(id));
  if (missing.length) {
    throw new ActionContractError(
      `These properties don't belong to the watched ${scope.scopeType === "database" ? "collection" : "page"}: ${missing.join(", ")}`,
      {
        errorCode: "WEBHOOK_PROPERTY_NOT_FOUND",
        details: { propertyIds: missing },
        statusCode: 400,
      },
    );
  }
}

export default defineAction({
  description:
    "Register a webhook: Content sends a signed POST to a public HTTPS URL when a property changes on a collection's rows or on one page, or when a comment there is created or resolved. Returns the signing secret once; store it, because list-content-webhooks never shows it again. Deliveries follow Standard Webhooks (webhook-id, webhook-timestamp, webhook-signature headers), are retried for about a day, and repeat the same event id on every retry. Requires admin access to the collection or page. Only edits to a value send property.changed; deleting properties, rows or pages, type changes that clear values, imports, and source syncs send no events.",
  mcpTool: true,
  // It adds a webhook and overwrites nothing, but every later change on the
  // collection or page is sent to the URL it names.
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  schema: z.object({
    url: z
      .string()
      .url()
      .describe(
        "Public HTTPS URL that receives the events; a host that is or resolves to a private, internal, or Tailnet (100.64.0.0/10) address is refused",
      ),
    databaseId: z
      .string()
      .optional()
      .describe(
        "Collection ID: watch every row of this collection. Pass this or documentId.",
      ),
    documentId: z
      .string()
      .optional()
      .describe("Page ID: watch one page. Pass this or databaseId."),
    events: z
      .array(z.enum(CONTENT_WEBHOOK_EVENT_TYPES))
      .min(1)
      .describe(
        "Events to send: property.changed (old and new value of one property when a value is edited; creating, importing, syncing or duplicating rows sends none yet), comment.created, comment.resolved",
      ),
    propertyIds: z
      .array(z.string())
      .min(1)
      .optional()
      .describe(
        "Send property.changed only for these property IDs; omit to send every property. An empty list is refused.",
      ),
    description: z
      .string()
      .max(200)
      .optional()
      .describe("What the receiver does, shown when listing webhooks"),
  }),
  run: async (args) => {
    const userEmail = getRequestUserEmail()?.trim().toLowerCase();
    // guard:allow-bare-error — invariant: actions run for a signed-in caller
    if (!userEmail) throw new Error("no authenticated user");
    const url = new URL(args.url);
    // The same check as each send: a name that resolves to a private or
    // Tailnet (100.64.0.0/10) address is refused, not just a literal one.
    if (
      url.protocol !== "https:" ||
      (await isBlockedExtensionUrlWithDns(args.url))
    ) {
      throw new ActionContractError(
        "Webhook URLs must be public HTTPS addresses.",
        { errorCode: "WEBHOOK_URL_NOT_ALLOWED", statusCode: 400 },
      );
    }
    const scope = await resolveContentWebhookScope(args);
    const propertyIds = args.propertyIds
      ? [...new Set(args.propertyIds)]
      : null;
    if (propertyIds) await assertPropertiesInScope(scope, propertyIds);

    const id = `wh_${nanoid(16)}`;
    const secret = generateContentWebhookSecret();
    const secretRef = scope.orgId
      ? {
          key: `content-webhook:${id}`,
          scope: "org" as const,
          scopeId: scope.orgId,
        }
      : {
          key: `content-webhook:${id}`,
          scope: "user" as const,
          scopeId: scope.ownerEmail.toLowerCase(),
        };
    await writeAppSecret({
      ...secretRef,
      value: secret,
      description: "Content webhook signing secret",
    });
    const now = new Date().toISOString();
    const row = {
      id,
      ownerEmail: scope.ownerEmail,
      orgId: scope.orgId,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      url: args.url,
      eventsJson: JSON.stringify([...new Set(args.events)]),
      propertyIdsJson: propertyIds ? JSON.stringify(propertyIds) : null,
      description: args.description?.trim() || null,
      secretScope: secretRef.scope,
      secretScopeId: secretRef.scopeId,
      secretKey: secretRef.key,
      createdBy: userEmail,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await getDb().transaction(async (tx) => {
        // One lock per collection or page, so two registrations can't both
        // count room for one more.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`content-webhook-scope:${scope.scopeType}:${scope.scopeId}`}, 0::bigint))`,
        );
        const existing = await tx
          .select({ id: schema.contentWebhooks.id })
          .from(schema.contentWebhooks)
          .where(
            and(
              eq(schema.contentWebhooks.scopeType, scope.scopeType),
              eq(schema.contentWebhooks.scopeId, scope.scopeId),
            ),
          );
        if (existing.length >= MAX_WEBHOOKS_PER_SCOPE) {
          throw new ActionContractError(
            `A ${scope.scopeType === "database" ? "collection" : "page"} can have at most ${MAX_WEBHOOKS_PER_SCOPE} webhooks; remove one first.`,
            { errorCode: "WEBHOOK_LIMIT", statusCode: 409 },
          );
        }
        await tx.insert(schema.contentWebhooks).values(row);
      });
    } catch (error) {
      await deleteAppSecret(secretRef).catch(() => undefined);
      throw error;
    }
    return {
      webhook: serializeContentWebhook(row),
      secret,
      signing: {
        scheme: "Standard Webhooks (https://www.standardwebhooks.com)",
        headers: ["webhook-id", "webhook-timestamp", "webhook-signature"],
        verify: `webhook-signature is "v1," + base64(HMAC-SHA256(key, "{webhook-id}.{webhook-timestamp}.{raw body}")), where key is the base64-decoded secret after "${CONTENT_WEBHOOK_SECRET_PREFIX}". Reject timestamps more than 5 minutes off.`,
      },
    };
  },
});
