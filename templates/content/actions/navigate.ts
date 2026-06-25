import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

type NavigateArgs = {
  path?: string;
  documentId?: string;
  databaseId?: string;
};

async function databaseDocumentIdForDatabaseId(databaseId: string) {
  const db = getDb();
  const [database] = await db
    .select({ documentId: schema.contentDatabases.documentId })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, databaseId));
  return database?.documentId ?? null;
}

export async function resolveNavigatePath(
  args: NavigateArgs,
  resolveDatabaseDocumentId = databaseDocumentIdForDatabaseId,
) {
  if (args.path) return args.path;
  if (args.documentId) return `/page/${args.documentId}`;
  if (args.databaseId) {
    const documentId = await resolveDatabaseDocumentId(args.databaseId);
    if (!documentId) throw new Error(`Database "${args.databaseId}" not found`);
    return `/page/${documentId}`;
  }
  throw new Error("At least --path, --documentId, or --databaseId is required");
}

export default defineAction({
  description:
    "Navigate the UI to a document, database, or view. Use --path for URL paths, --documentId for pages, or --databaseId for database pages.",
  schema: z.object({
    path: z
      .string()
      .optional()
      .describe(
        'URL path to navigate to (e.g. "/" for list, "/abc123" for a document)',
      ),
    documentId: z
      .string()
      .optional()
      .describe("Document/page ID to open (shorthand for --path=/page/<id>)"),
    databaseId: z
      .string()
      .optional()
      .describe("Content database ID to open by its backing page"),
  }),
  http: false,
  run: async (args) => {
    const path = await resolveNavigatePath(args);

    await writeAppState("navigate", { path, ts: Date.now() });
    return `Navigating to ${path}`;
  },
});
