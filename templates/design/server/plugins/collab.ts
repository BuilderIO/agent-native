import { createCollabPlugin } from "@agent-native/core/server";
import { getDb, schema } from "../db/index.js";
import { eq } from "drizzle-orm";

export default createCollabPlugin({
  table: "design_files",
  contentColumn: "content",
  idColumn: "id",
  autoSeed: true,
  resourceType: "design",
  resolveResourceId: async (docId) => {
    const db = getDb();
    const [file] = await db
      .select({ designId: schema.designFiles.designId })
      .from(schema.designFiles)
      .where(eq(schema.designFiles.id, docId));
    return file?.designId ?? null;
  },
});
