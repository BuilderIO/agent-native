/**
 * Partially update a recording — title, description, folder, tags,
 * flags (enableComments/Reactions/Downloads), defaultSpeed.
 *
 * Usage:
 *   pnpm action update-recording --id=<id> --title="New title"
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { nanoid, stringifySpaceIds } from "../server/lib/recordings.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

const cliBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

export default defineAction({
  description:
    "Partially update a recording's metadata and flags. All fields are optional — only the ones you pass get updated. Tags replace the existing tag set when provided.",
  schema: z.object({
    id: z.string().describe("Recording ID"),
    title: z.string().optional(),
    description: z.string().optional(),
    folderId: z.string().nullish(),
    spaceIds: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    enableComments: z.union([z.boolean(), cliBoolean]).optional(),
    enableReactions: z.union([z.boolean(), cliBoolean]).optional(),
    enableDownloads: z.union([z.boolean(), cliBoolean]).optional(),
    defaultSpeed: z.string().optional(),
    animatedThumbnailEnabled: z.union([z.boolean(), cliBoolean]).optional(),
    password: z.string().nullish(),
    expiresAt: z.string().nullish(),
    chaptersJson: z.string().optional(),
  }),
  run: async (args) => {
    await assertAccess("recording", args.id, "editor");

    const db = getDb();

    const [existing] = await db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.id));
    if (!existing) throw new Error(`Recording not found: ${args.id}`);

    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (typeof args.title === "string") patch.title = args.title.trim();
    if (typeof args.description === "string")
      patch.description = args.description;
    if (args.folderId !== undefined) patch.folderId = args.folderId ?? null;
    if (args.spaceIds) patch.spaceIds = stringifySpaceIds(args.spaceIds);
    if (typeof args.enableComments === "boolean")
      patch.enableComments = args.enableComments;
    if (typeof args.enableReactions === "boolean")
      patch.enableReactions = args.enableReactions;
    if (typeof args.enableDownloads === "boolean")
      patch.enableDownloads = args.enableDownloads;
    if (typeof args.defaultSpeed === "string")
      patch.defaultSpeed = args.defaultSpeed;
    if (typeof args.animatedThumbnailEnabled === "boolean")
      patch.animatedThumbnailEnabled = args.animatedThumbnailEnabled;
    if (args.password !== undefined) patch.password = args.password ?? null;
    if (args.expiresAt !== undefined) patch.expiresAt = args.expiresAt ?? null;
    if (typeof args.chaptersJson === "string")
      patch.chaptersJson = args.chaptersJson;

    await db
      .update(schema.recordings)
      .set(patch)
      .where(eq(schema.recordings.id, args.id));

    // Replace tag set if tags were provided.
    if (args.tags) {
      await db
        .delete(schema.recordingTags)
        .where(eq(schema.recordingTags.recordingId, args.id));
      for (const tag of args.tags) {
        const clean = tag.trim();
        if (!clean) continue;
        await db.insert(schema.recordingTags).values({
          id: nanoid(),
          recordingId: args.id,
          organizationId: existing.organizationId,
          tag: clean,
        });
      }
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    const [updated] = await db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.id));

    console.log(`Updated recording ${args.id}`);
    return { id: args.id, recording: updated };
  },
});
