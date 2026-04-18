import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCallOrThrow,
  stringifySpaceIds,
} from "../server/lib/calls.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Partially update a call's mutable fields. Only fields you pass are changed.",
  schema: z.object({
    id: z.string().describe("Call ID"),
    title: z.string().optional().describe("Call title"),
    description: z.string().optional().describe("Call description"),
    folderId: z.string().nullish().describe("Folder id (null = root)"),
    spaceIds: z
      .array(z.string())
      .optional()
      .describe("Replacement space id list (JSON-serialized on disk)"),
    password: z
      .string()
      .nullish()
      .describe("Share password (null to clear)"),
    expiresAt: z
      .string()
      .nullish()
      .describe("ISO timestamp the share expires (null to clear)"),
    shareIncludesSummary: z
      .boolean()
      .optional()
      .describe("Whether the public share link shows the AI summary"),
    shareIncludesTranscript: z
      .boolean()
      .optional()
      .describe("Whether the public share link shows the transcript"),
    enableComments: z.boolean().optional().describe("Allow comments"),
    enableDownloads: z.boolean().optional().describe("Allow media download"),
    defaultSpeed: z
      .string()
      .optional()
      .describe("Default playback speed (e.g. '1.0', '1.25')"),
    accountId: z
      .string()
      .nullish()
      .describe("Account id this call belongs to (null to clear)"),
    dealStage: z
      .string()
      .nullish()
      .describe("Deal stage label (null to clear)"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    await assertAccess("call", args.id, "editor");
    await getCallOrThrow(args.id);

    const db = getDb();
    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (typeof args.title === "string") patch.title = args.title.trim();
    if (typeof args.description === "string") patch.description = args.description;
    if (args.folderId !== undefined) patch.folderId = args.folderId ?? null;
    if (args.spaceIds) patch.spaceIds = stringifySpaceIds(args.spaceIds);
    if (args.password !== undefined) patch.password = args.password ?? null;
    if (args.expiresAt !== undefined) patch.expiresAt = args.expiresAt ?? null;
    if (typeof args.shareIncludesSummary === "boolean")
      patch.shareIncludesSummary = args.shareIncludesSummary;
    if (typeof args.shareIncludesTranscript === "boolean")
      patch.shareIncludesTranscript = args.shareIncludesTranscript;
    if (typeof args.enableComments === "boolean")
      patch.enableComments = args.enableComments;
    if (typeof args.enableDownloads === "boolean")
      patch.enableDownloads = args.enableDownloads;
    if (typeof args.defaultSpeed === "string")
      patch.defaultSpeed = args.defaultSpeed;
    if (args.accountId !== undefined) patch.accountId = args.accountId ?? null;
    if (args.dealStage !== undefined) patch.dealStage = args.dealStage ?? null;

    await db.update(schema.calls).set(patch).where(eq(schema.calls.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    const [updated] = await db
      .select()
      .from(schema.calls)
      .where(eq(schema.calls.id, args.id));

    return { id: args.id, call: updated };
  },
});
