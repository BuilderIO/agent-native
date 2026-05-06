import { defineAction } from "@agent-native/core";
import { signShortLivedToken } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  buildCodingHandoffPrompt,
  buildRawHandoffUrl,
  normalizeHandoffFormat,
} from "../server/lib/coding-handoff.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

const HANDOFF_TTL_SECONDS = 7 * 24 * 60 * 60;

export default defineAction({
  description:
    "Create a coding-tool handoff for a design project. Returns a tokenized raw-code URL " +
    "that external agents can fetch, plus a ready-to-copy prompt containing that URL.",
  schema: z.object({
    id: z.string().describe("Design ID to export for coding tools"),
    origin: z
      .string()
      .optional()
      .describe(
        "Optional app origin such as https://design.agent-native.com. Used to return an absolute raw-code URL.",
      ),
    format: z
      .enum(["markdown", "json"])
      .optional()
      .default("markdown")
      .describe("Raw bundle response format for the generated URL"),
  }),
  readOnly: true,
  run: async ({ id, origin, format }) => {
    const access = await assertAccess("design", id, "viewer");
    const design = access.resource as typeof schema.designs.$inferSelect;
    const db = getDb();

    const files = await db
      .select({
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, id));

    if (files.length === 0) {
      throw new Error("This design has no files to hand off yet");
    }

    const token = signShortLivedToken({
      resourceId: id,
      ttlSeconds: HANDOFF_TTL_SECONDS,
    });
    const handoffFormat = normalizeHandoffFormat(format);
    const rawUrl = buildRawHandoffUrl({
      id,
      token,
      origin,
      format: handoffFormat,
    });
    const prompt = buildCodingHandoffPrompt({
      rawUrl,
      title: design.title,
      fileCount: files.length,
    });

    return {
      designId: id,
      rawUrl,
      prompt,
      clipboardText: prompt,
      format: handoffFormat,
      fileCount: files.length,
      expiresAt: new Date(Date.now() + HANDOFF_TTL_SECONDS * 1000).toISOString(),
    };
  },
});
