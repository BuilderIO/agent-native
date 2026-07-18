import { assertAccess } from "@agent-native/core/sharing";
import { workflowSubscriptions } from "@agent-native/core/workflow";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  contentDefaultPersonSubscriptionId,
  contentHookConfigFromJson,
  requireContentDatabaseAccess,
} from "./_content-database-hooks.js";
import type { ContentNotificationPreferenceTarget } from "./_content-notification-preferences.js";

export async function assertContentNotificationPreferenceTarget(
  target: ContentNotificationPreferenceTarget,
) {
  if (target.scope === "global") return;
  if (!target.databaseId) {
    throw new Error("A database ID is required for this preference scope.");
  }
  await requireContentDatabaseAccess(target.databaseId, "viewer");
  if (target.scope === "database") return;

  if (target.scope === "item") {
    if (!target.documentId) throw new Error("An item page ID is required.");
    await assertAccess("document", target.documentId, "viewer");
    const [membership] = await getDb()
      .select({ id: schema.contentDatabaseItems.id })
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(schema.contentDatabaseItems.databaseId, target.databaseId),
          eq(schema.contentDatabaseItems.documentId, target.documentId),
        ),
      );
    if (!membership) {
      throw new Error("The item does not belong to this database.");
    }
    return;
  }

  if (!target.subscriptionId) {
    throw new Error("A notification rule ID is required.");
  }
  if (
    target.subscriptionId ===
    contentDefaultPersonSubscriptionId(target.databaseId)
  ) {
    return;
  }
  const [subscription] = await getDb()
    .select({ config: workflowSubscriptions.config })
    .from(workflowSubscriptions)
    .where(eq(workflowSubscriptions.id, target.subscriptionId));
  const config = subscription
    ? contentHookConfigFromJson(subscription.config)
    : null;
  if (!config || config.databaseId !== target.databaseId) {
    throw new Error("The notification rule does not belong to this database.");
  }
}
