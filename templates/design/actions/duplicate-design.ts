import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { annotateScreenHtmlForPersist } from "../shared/screen-annotation.js";

export default defineAction({
  description:
    "Duplicate an existing design project, creating a deep copy with new IDs " +
    "for the design and all its files. Returns the new design's ID and title.",
  schema: z.object({
    id: z.string().describe("Source design ID to duplicate"),
    title: z
      .string()
      .optional()
      .describe("Title for the copy (defaults to 'Copy of ...')"),
  }),
  run: async ({ id, title }) => {
    const access = await resolveAccess("design", id);
    if (!access) throw new Error(`Design not found: ${id}`);

    const source = access.resource;
    const db = getDb();
    const newId = nanoid();
    const now = new Date().toISOString();
    const newTitle = title || `Copy of ${source.title}`;

    // Fetch source files first so we can remap canvasFrames before inserting
    const files = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, id));

    // Build old-to-new file ID mapping upfront
    const idMap = new Map<string, string>(
      files.map((file) => [file.id, nanoid()]),
    );

    // Remap canvasFrames keys in source.data from old IDs to new IDs
    let newData = source.data;
    try {
      const parsed =
        typeof source.data === "string" ? JSON.parse(source.data) : source.data;
      if (parsed && typeof parsed === "object" && parsed.canvasFrames) {
        const remapped: Record<string, unknown> = {};
        for (const [oldId, geometry] of Object.entries(parsed.canvasFrames)) {
          const newFileId = idMap.get(oldId);
          remapped[newFileId ?? oldId] = geometry;
        }
        newData =
          typeof source.data === "string"
            ? JSON.stringify({ ...parsed, canvasFrames: remapped })
            : { ...parsed, canvasFrames: remapped };
      }
    } catch {
      // If data is unparseable, fall back to copying verbatim
    }

    // Copy the design with remapped canvasFrames
    const orgId = getRequestOrgId() || null;
    await db.insert(schema.designs).values({
      id: newId,
      title: newTitle,
      description: source.description,
      projectType: source.projectType,
      designSystemId: source.designSystemId ?? null,
      data: newData,
      ownerEmail: (() => {
        const e = getRequestUserEmail();
        if (!e) throw new Error("no authenticated user");
        return e;
      })(),
      orgId,
      visibility: orgId ? "org" : "private",
      createdAt: now,
      updatedAt: now,
    });

    // Copy all associated files using the pre-generated IDs. `content` is
    // copied verbatim, including any `data-agent-native-node-id` attributes
    // already stamped on the source screen — those ids are NOT regenerated
    // here.
    //
    // This is a deliberate simplification, not an oversight: node ids are
    // scoped to a single file's DOM, never looked up globally. Every
    // consumer (buildCodeLayerProjection/ensureCodeLayerNodeIdsInHtml in
    // shared/code-layer.ts, the MultiScreenCanvas/editor-chrome bridge
    // querySelectorAll calls) resolves ids against one screen's parsed HTML
    // or one iframe's contentDocument, and each design's screens render in
    // their own isolated iframe — so a duplicated screen sharing ids with its
    // source design is harmless: there is no code path that queries two
    // screens' DOMs together. Regenerating ids here would additionally have
    // to rewrite every `[data-agent-native-node-id="..."]` selector embedded
    // inline by shared/motion-compiler.ts and shared/interaction-states.ts
    // (motion timelines and hover/focus states target nodes by id in CSS
    // baked into the same HTML string) to keep them pointing at the
    // corresponding element — a real rewrite with real regression risk
    // (silently dropped motion/interaction styling on duplicated screens) to
    // fix a collision that has no observable effect. If a future feature
    // introduces cross-design lookups keyed on node id alone (e.g. pasting
    // one design's screen into another), reconsider this and add an id-remap
    // pass that also rewrites those embedded CSS selectors in lockstep.
    //
    // Still fill in any MISSING ids (belt-and-suspenders for designs
    // generated/imported before ids were stamped at creation time): this only
    // adds ids where none exist and never touches an id that's already
    // present, so it can't disturb the existing-id-copy contract above.
    for (const file of files) {
      await db.insert(schema.designFiles).values({
        id: idMap.get(file.id)!,
        designId: newId,
        filename: file.filename,
        fileType: file.fileType,
        content: annotateScreenHtmlForPersist(file.content, file.fileType),
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      id: newId,
      title: newTitle,
      fileCount: files.length,
    };
  },
});
