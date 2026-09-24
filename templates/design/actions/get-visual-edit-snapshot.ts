import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Read the latest shared HTML fallback for one Localhost screen. Design access is required; the owner's local server is never contacted.",
  schema: z.object({
    designId: z.string().min(1).describe("Design project ID."),
    fileId: z.string().min(1).describe("Localhost screen file ID."),
    knownUpdatedAt: z
      .string()
      .nullable()
      .optional()
      .describe("Timestamp of the latest snapshot already held by the viewer."),
  }),
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  mcpTool: false,
  capabilityScopes: ["visual-edit"],
  http: { method: "GET" },
  maxResultChars: 1_052_000,
  run: async ({ designId, fileId, knownUpdatedAt }) => {
    await assertAccess("design", designId, "viewer");

    const [snapshot] = await getDb()
      .select({
        html: schema.designVisualEditSnapshots.html,
        updatedAt: schema.designVisualEditSnapshots.updatedAt,
      })
      .from(schema.designVisualEditSnapshots)
      .where(
        and(
          eq(schema.designVisualEditSnapshots.designId, designId),
          eq(schema.designVisualEditSnapshots.fileId, fileId),
        ),
      )
      .limit(1);

    return {
      designId,
      fileId,
      html:
        snapshot && snapshot.updatedAt !== knownUpdatedAt
          ? snapshot.html
          : null,
      updatedAt: snapshot?.updatedAt ?? null,
      unchanged: Boolean(snapshot && snapshot.updatedAt === knownUpdatedAt),
    };
  },
});
