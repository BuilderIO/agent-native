import { defineAction, fail } from "@agent-native/core/action";
import { readPrivateBlob } from "@agent-native/core/private-blob";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import { parseVisualEditSnapshotBlobHandle } from "../server/lib/visual-edit-snapshot-blobs.js";
import { assertLocalhostScreenMetadata } from "./publish-visual-edit-snapshot.js";

const MAX_SNAPSHOT_BYTES = 1024 * 1024;

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
    const access = await assertAccess("design", designId, "viewer");
    const design = access.resource as typeof schema.designs.$inferSelect;

    const db = getDb();
    const [file] = await db
      .select({
        content: schema.designFiles.content,
        fileType: schema.designFiles.fileType,
      })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.designId, designId),
          eq(schema.designFiles.id, fileId),
        ),
      )
      .limit(1);
    if (!file) {
      fail("The screen does not belong to this design.", {
        errorCode: "visual_edit_snapshot_file_mismatch",
      });
    }
    if (file.fileType.toLowerCase() !== "html") {
      fail("Visual-edit snapshots can only be read for HTML screens.", {
        errorCode: "visual_edit_snapshot_not_html",
      });
    }
    assertLocalhostScreenMetadata(design.data, fileId, file.content);

    const table = schema.designVisualEditSnapshots;
    const where = and(eq(table.designId, designId), eq(table.fileId, fileId));
    const [latest] = await db
      .select({
        updatedAt: table.updatedAt,
      })
      .from(table)
      .where(where)
      .limit(1);

    if (!latest) {
      return {
        designId,
        fileId,
        html: null,
        updatedAt: null,
        unchanged: false,
      };
    }
    if (knownUpdatedAt && latest.updatedAt === knownUpdatedAt) {
      return {
        designId,
        fileId,
        html: null,
        updatedAt: latest.updatedAt,
        unchanged: true,
      };
    }

    const [snapshot] = await db
      .select({
        html: table.html,
        blobHandle: table.blobHandle,
        updatedAt: table.updatedAt,
      })
      .from(table)
      .where(where)
      .limit(1);
    const hasSnapshot = Boolean(snapshot?.blobHandle || snapshot?.html);
    if (!hasSnapshot || !snapshot) {
      return {
        designId,
        fileId,
        html: null,
        updatedAt: null,
        unchanged: false,
      };
    }
    if (snapshot.updatedAt === knownUpdatedAt) {
      return {
        designId,
        fileId,
        html: null,
        updatedAt: snapshot.updatedAt,
        unchanged: true,
      };
    }

    let html: string;
    if (snapshot.blobHandle) {
      const blob = await readPrivateBlob(
        parseVisualEditSnapshotBlobHandle(snapshot.blobHandle),
      );
      if (blob.data.byteLength > MAX_SNAPSHOT_BYTES) {
        throw new Error("Stored visual-edit snapshot exceeds the 1 MiB limit.");
      }
      html = new TextDecoder("utf-8", { fatal: true }).decode(blob.data);
    } else {
      // Existing pre-blob rows stay readable until an owner publishes their next snapshot.
      html = snapshot.html;
      if (new TextEncoder().encode(html).byteLength > MAX_SNAPSHOT_BYTES) {
        throw new Error("Stored visual-edit snapshot exceeds the 1 MiB limit.");
      }
    }

    return {
      designId,
      fileId,
      html,
      updatedAt: snapshot.updatedAt,
      unchanged: false,
    };
  },
});
