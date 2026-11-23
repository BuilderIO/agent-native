import { and, eq } from "@agent-native/core/db/schema";
import { asc } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { ensureAnalyticsDatabase } from "./database.js";

export async function linkProjectConnection(input: {
  orgId: string;
  projectId: string;
  connectionId: string;
  createdBy: string;
}): Promise<void> {
  await ensureAnalyticsDatabase();
  await getDb()
    .insert(schema.projectConnectionLinks)
    .values(input)
    .onConflictDoNothing();
}

export async function listProjectConnectionLinks(input: {
  orgId: string;
  projectId: string;
}): Promise<string[]> {
  await ensureAnalyticsDatabase();
  const rows = await getDb()
    .select({ connectionId: schema.projectConnectionLinks.connectionId })
    .from(schema.projectConnectionLinks)
    .where(
      and(
        eq(schema.projectConnectionLinks.projectId, input.projectId),
        eq(schema.projectConnectionLinks.orgId, input.orgId),
      ),
    )
    .orderBy(
      asc(schema.projectConnectionLinks.createdAt),
      asc(schema.projectConnectionLinks.connectionId),
    );
  return rows.map((row) => row.connectionId);
}
