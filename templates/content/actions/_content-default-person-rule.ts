import {
  ensureVirtualWorkflowProviderEvaluationStart,
  registerVirtualWorkflowSubscriptionProvider,
  type WorkflowEvent,
  type WorkflowSubscriptionInput,
} from "@agent-native/core/workflow";
import { and, desc, eq, isNull, lt } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { contentDefaultPersonSubscriptionId } from "./_content-database-hooks.js";

const PROVIDER_ID = "content.default-person-notifications.v1";
export const CONTENT_DEFAULT_PERSON_POLICY_KEY = "default_person_notifications";

export function contentDefaultPersonSubscriptionInput(input: {
  databaseId: string;
  ownerEmail: string;
  orgId?: string | null;
  enabled: boolean;
}): WorkflowSubscriptionInput {
  return {
    id: contentDefaultPersonSubscriptionId(input.databaseId),
    kind: "deterministic",
    eventPattern: "content.database.*",
    ownerEmail: input.ownerEmail,
    orgId: input.orgId ?? null,
    enabled: input.enabled,
    config: {
      domain: "content",
      resourceId: input.databaseId,
      system: "default_person_notifications",
      databaseId: input.databaseId,
      name: "Content mention",
      policy: {
        enabled: input.enabled,
        source: "database_policy",
        ...(input.enabled ? {} : { disabledReason: "owner_disabled" }),
      },
    },
  };
}

function hasNewPersonRecipients(event: WorkflowEvent): boolean {
  if (
    event.topic === "content.database.property.changed" &&
    event.payload.propertyType === "person"
  ) {
    const before = new Set(
      Array.isArray(event.payload.beforeValue)
        ? event.payload.beforeValue.filter(
            (value): value is string =>
              typeof value === "string" && Boolean(value),
          )
        : [],
    );
    return (
      Array.isArray(event.payload.afterValue) &&
      event.payload.afterValue.some(
        (value) =>
          typeof value === "string" && Boolean(value) && !before.has(value),
      )
    );
  }
  if (event.topic !== "content.database.item.submitted") return false;
  const personPropertyIds = Array.isArray(event.payload.personPropertyIds)
    ? event.payload.personPropertyIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const propertyValues =
    event.payload.propertyValues &&
    typeof event.payload.propertyValues === "object" &&
    !Array.isArray(event.payload.propertyValues)
      ? (event.payload.propertyValues as Record<string, unknown>)
      : {};
  return personPropertyIds.some(
    (propertyId) =>
      Array.isArray(propertyValues[propertyId]) &&
      propertyValues[propertyId].some(
        (value) => typeof value === "string" && Boolean(value),
      ),
  );
}

export async function registerContentDefaultPersonVirtualRule(): Promise<void> {
  const evaluationStartSequence =
    await ensureVirtualWorkflowProviderEvaluationStart(PROVIDER_ID);
  registerVirtualWorkflowSubscriptionProvider({
    id: PROVIDER_ID,
    evaluationStartSequence,
    async subscriptionsForEvent(event) {
      const databaseId =
        typeof event.payload.databaseId === "string"
          ? event.payload.databaseId
          : "";
      if (!databaseId || !hasNewPersonRecipients(event)) return [];
      const [database] = await getDb()
        .select({ id: schema.contentDatabases.id })
        .from(schema.contentDatabases)
        .where(
          and(
            eq(schema.contentDatabases.id, databaseId),
            eq(schema.contentDatabases.ownerEmail, event.ownerEmail),
            event.orgId == null
              ? isNull(schema.contentDatabases.orgId)
              : eq(schema.contentDatabases.orgId, event.orgId),
          ),
        );
      if (!database) return [];
      const [policy] = await getDb()
        .select({
          version: schema.contentDatabasePolicies.version,
          enabled: schema.contentDatabasePolicies.enabled,
        })
        .from(schema.contentDatabasePolicies)
        .where(
          and(
            eq(schema.contentDatabasePolicies.databaseId, databaseId),
            eq(
              schema.contentDatabasePolicies.policyKey,
              CONTENT_DEFAULT_PERSON_POLICY_KEY,
            ),
            eq(schema.contentDatabasePolicies.ownerEmail, event.ownerEmail),
            eq(schema.contentDatabasePolicies.orgId, event.orgId ?? ""),
            lt(
              schema.contentDatabasePolicies.activeAfterSequence,
              event.eventSequence,
            ),
          ),
        )
        .orderBy(
          desc(schema.contentDatabasePolicies.activeAfterSequence),
          desc(schema.contentDatabasePolicies.version),
        )
        .limit(1);
      const enabled = policy?.enabled ?? true;
      return [
        {
          ...contentDefaultPersonSubscriptionInput({
            databaseId,
            ownerEmail: event.ownerEmail,
            orgId: event.orgId,
            enabled,
          }),
          version: policy?.version ?? 1,
        },
      ];
    },
  });
}
