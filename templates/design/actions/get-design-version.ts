import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  type DesignVersionChatContext,
  readDesignVersionSnapshot,
} from "../server/lib/design-versions.js";

function parseChatContext(raw: string | null): DesignVersionChatContext | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // coercion-ok: malformed chatContext JSON is absent metadata, not a successful parse.
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const context: DesignVersionChatContext = {};
  for (const key of ["threadId", "runId", "turnId", "actionName"] as const) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.trim()) {
      context[key] = candidate;
    }
  }
  return Object.keys(context).length > 0 ? context : null;
}

export default defineAction({
  description:
    "Get one Design history checkpoint for preview before restore, including " +
    "file contents and metadata.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    versionId: z.string().describe("Design history checkpoint ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ designId, versionId }) => {
    await assertAccess("design", designId, "viewer");
    const db = getDb();
    const [version] = await db
      .select({
        id: schema.designVersions.id,
        label: schema.designVersions.label,
        createdAt: schema.designVersions.createdAt,
        chatContext: schema.designVersions.chatContext,
        fileCount: schema.designVersions.fileCount,
        snapshot: schema.designVersions.snapshot,
      })
      .from(schema.designVersions)
      .where(
        and(
          eq(schema.designVersions.id, versionId),
          eq(schema.designVersions.designId, designId),
        ),
      )
      .limit(1);

    if (!version) {
      throw new Error(`Design version not found: ${versionId}`);
    }

    const snapshot = await readDesignVersionSnapshot(
      version.snapshot,
      designId,
    );
    const chatContext = parseChatContext(version.chatContext);

    return {
      id: version.id,
      designId,
      label: version.label,
      createdAt: version.createdAt,
      source: chatContext ? ("chat" as const) : ("legacy" as const),
      fileCount: version.fileCount ?? snapshot.files.length,
      chatContext,
      designTitle: snapshot.designTitle ?? null,
      files: snapshot.files.map((file) => ({
        id: file.id ?? null,
        filename: file.filename,
        fileType: file.fileType,
        content: file.content,
      })),
    };
  },
});
