import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { nanoid } from "./_property-utils.js";

export const CONTENT_NOTIFICATION_GLOBAL_SCOPE_ID = "content";

export type ContentNotificationPreferenceScope =
  | "global"
  | "database"
  | "rule"
  | "item";

export interface ContentNotificationPreferenceTarget {
  scope: ContentNotificationPreferenceScope;
  databaseId?: string;
  subscriptionId?: string;
  documentId?: string;
}

export interface ResolvedContentNotificationPreference {
  enabled: boolean;
  source: ContentNotificationPreferenceScope | "default";
  preferenceId: string | null;
}

export function contentNotificationPreferenceScopeId(
  target: ContentNotificationPreferenceTarget,
): string {
  if (target.scope === "global") return CONTENT_NOTIFICATION_GLOBAL_SCOPE_ID;
  if (target.scope === "database" && target.databaseId) {
    return target.databaseId;
  }
  if (target.scope === "rule" && target.subscriptionId) {
    return target.subscriptionId;
  }
  if (target.scope === "item" && target.documentId) return target.documentId;
  throw new Error(
    `A stable ${target.scope} notification scope ID is required.`,
  );
}

export async function setContentNotificationPreference(args: {
  ownerEmail: string;
  orgId?: string | null;
  target: ContentNotificationPreferenceTarget;
  enabled: boolean;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const orgId = args.orgId ?? "";
  const scopeId = contentNotificationPreferenceScopeId(args.target);
  const values = {
    id: nanoid(),
    ownerEmail: args.ownerEmail,
    orgId,
    scope: args.target.scope,
    scopeId,
    databaseId: args.target.databaseId ?? null,
    subscriptionId: args.target.subscriptionId ?? null,
    documentId: args.target.documentId ?? null,
    enabled: args.enabled,
    createdAt: now,
    updatedAt: now,
  };
  await db
    .insert(schema.contentNotificationPreferences)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.contentNotificationPreferences.ownerEmail,
        schema.contentNotificationPreferences.orgId,
        schema.contentNotificationPreferences.scope,
        schema.contentNotificationPreferences.scopeId,
      ],
      set: {
        databaseId: values.databaseId,
        subscriptionId: values.subscriptionId,
        documentId: values.documentId,
        enabled: values.enabled,
        updatedAt: now,
      },
    });
  const [saved] = await db
    .select()
    .from(schema.contentNotificationPreferences)
    .where(
      and(
        eq(schema.contentNotificationPreferences.ownerEmail, args.ownerEmail),
        eq(schema.contentNotificationPreferences.orgId, orgId),
        eq(schema.contentNotificationPreferences.scope, args.target.scope),
        eq(schema.contentNotificationPreferences.scopeId, scopeId),
      ),
    );
  if (!saved) throw new Error("Notification preference was not persisted.");
  return saved;
}

export async function removeContentNotificationPreference(args: {
  ownerEmail: string;
  orgId?: string | null;
  target: ContentNotificationPreferenceTarget;
}) {
  const scopeId = contentNotificationPreferenceScopeId(args.target);
  await getDb()
    .delete(schema.contentNotificationPreferences)
    .where(
      and(
        eq(schema.contentNotificationPreferences.ownerEmail, args.ownerEmail),
        eq(schema.contentNotificationPreferences.orgId, args.orgId ?? ""),
        eq(schema.contentNotificationPreferences.scope, args.target.scope),
        eq(schema.contentNotificationPreferences.scopeId, scopeId),
      ),
    );
}

export async function resolveContentNotificationPreference(args: {
  ownerEmail: string;
  orgId?: string | null;
  databaseId?: string;
  subscriptionId?: string;
  documentId?: string;
}): Promise<ResolvedContentNotificationPreference> {
  const rows = await getDb()
    .select()
    .from(schema.contentNotificationPreferences)
    .where(
      and(
        eq(schema.contentNotificationPreferences.ownerEmail, args.ownerEmail),
        eq(schema.contentNotificationPreferences.orgId, args.orgId ?? ""),
      ),
    );
  const candidates: Array<{
    source: ContentNotificationPreferenceScope;
    scopeId: string;
  }> = [];
  if (args.documentId) {
    candidates.push({ source: "item", scopeId: args.documentId });
  }
  if (args.subscriptionId) {
    candidates.push({ source: "rule", scopeId: args.subscriptionId });
  }
  if (args.databaseId) {
    candidates.push({ source: "database", scopeId: args.databaseId });
  }
  candidates.push({
    source: "global",
    scopeId: CONTENT_NOTIFICATION_GLOBAL_SCOPE_ID,
  });
  for (const candidate of candidates) {
    const row = rows.find(
      (preference) =>
        preference.scope === candidate.source &&
        preference.scopeId === candidate.scopeId,
    );
    if (row) {
      return {
        enabled: row.enabled,
        source: candidate.source,
        preferenceId: row.id,
      };
    }
  }
  return { enabled: true, source: "default", preferenceId: null };
}
