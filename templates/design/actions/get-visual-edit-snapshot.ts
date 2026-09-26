import { defineAction, fail } from "@agent-native/core/action";
import { readPrivateBlob } from "@agent-native/core/private-blob";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import { parseVisualEditSnapshotBlobHandle } from "../server/lib/visual-edit-snapshot-blobs.js";
import { withDesignSourceReadTransaction } from "../server/source-workspace.js";
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
      .describe("Legacy timestamp hint accepted for older viewers."),
    knownPublishedRevision: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Published revision of the latest snapshot already held by the viewer.",
      ),
  }),
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  mcpTool: false,
  capabilityScopes: ["visual-edit"],
  http: { method: "GET" },
  maxResultChars: 1_052_000,
  run: async ({ designId, fileId, knownUpdatedAt, knownPublishedRevision }) => {
    await assertAccess("design", designId, "viewer");
    const table = schema.designVisualEditSnapshots;
    const where = and(eq(table.designId, designId), eq(table.fileId, fileId));
    const snapshot = await withDesignSourceReadTransaction(
      designId,
      async (tx) => {
        const [currentDesign] = await tx
          .select({
            data: schema.designs.data,
            liveCollaborationEnabled: schema.designs.liveCollaborationEnabled,
          })
          .from(schema.designs)
          .where(eq(schema.designs.id, designId))
          .limit(1);
        if (!currentDesign) {
          return {
            kind: "disabled" as const,
            captureRevision: "0",
          };
        }

        if (currentDesign.liveCollaborationEnabled !== true) {
          const [row] = await tx
            .select({ captureRevision: table.captureRevision })
            .from(table)
            .where(where)
            .limit(1);
          return {
            kind: "disabled" as const,
            captureRevision: row?.captureRevision.toString() ?? "0",
          };
        }

        const [file] = await tx
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
        assertLocalhostScreenMetadata(currentDesign.data, fileId, file.content);

        const [row] = await tx
          .select({
            html: table.html,
            blobHandle: table.blobHandle,
            updatedAt: table.updatedAt,
            captureRevision: table.captureRevision,
            publishedRevision: table.publishedRevision,
          })
          .from(table)
          .where(where)
          .limit(1);
        if (!row) {
          return {
            kind: "empty" as const,
            captureRevision: "0",
            publishedRevision: null,
          };
        }

        const publishedRevision = row.publishedRevision.toString();
        const captureRevision = row.captureRevision.toString();
        const unchanged =
          knownPublishedRevision != null
            ? publishedRevision === knownPublishedRevision
            : Boolean(knownUpdatedAt && row.updatedAt === knownUpdatedAt);
        if (unchanged) {
          return {
            kind: "unchanged" as const,
            updatedAt: row.updatedAt,
            captureRevision,
            publishedRevision,
          };
        }
        if (!row.blobHandle && !row.html) {
          return {
            kind: "empty" as const,
            captureRevision,
            publishedRevision:
              row.publishedRevision === 0n ? null : publishedRevision,
          };
        }
        return {
          kind: "snapshot" as const,
          html: row.html,
          blobHandle: row.blobHandle,
          updatedAt: row.updatedAt,
          captureRevision,
          publishedRevision,
        };
      },
    );

    const empty = {
      designId,
      fileId,
      html: null,
      updatedAt: null,
      publishedRevision: null,
      captureRevision:
        snapshot?.kind === "disabled" ? snapshot.captureRevision : null,
      unchanged: false,
    };
    if (!snapshot || snapshot.kind === "disabled") {
      return {
        ...empty,
        captureRevision:
          snapshot?.kind === "disabled" ? snapshot.captureRevision : null,
      };
    }
    if (snapshot.kind === "empty") {
      return {
        ...empty,
        captureRevision: snapshot.captureRevision,
        publishedRevision: snapshot.publishedRevision,
      };
    }
    if (snapshot.kind === "unchanged") {
      return {
        ...empty,
        updatedAt: snapshot.updatedAt,
        captureRevision: snapshot.captureRevision,
        publishedRevision: snapshot.publishedRevision,
        unchanged: true,
      };
    }

    let html = snapshot.html;
    if (snapshot.blobHandle) {
      const blob = await readPrivateBlob(
        parseVisualEditSnapshotBlobHandle(snapshot.blobHandle),
      );
      if (blob.data.byteLength > MAX_SNAPSHOT_BYTES) {
        throw new Error("Stored visual-edit snapshot exceeds the 1 MiB limit.");
      }
      html = new TextDecoder("utf-8", { fatal: true }).decode(blob.data);
    }
    if (new TextEncoder().encode(html).byteLength > MAX_SNAPSHOT_BYTES) {
      throw new Error("Stored visual-edit snapshot exceeds the 1 MiB limit.");
    }

    // Keep remote blob I/O outside the shared read lock, then reject opt-out or replacement races.
    const stillCurrent = await withDesignSourceReadTransaction(
      designId,
      async (tx) => {
        const [currentDesign] = await tx
          .select({
            liveCollaborationEnabled: schema.designs.liveCollaborationEnabled,
          })
          .from(schema.designs)
          .where(eq(schema.designs.id, designId))
          .limit(1);
        const [current] = await tx
          .select({
            html: table.html,
            blobHandle: table.blobHandle,
            updatedAt: table.updatedAt,
            captureRevision: table.captureRevision,
            publishedRevision: table.publishedRevision,
          })
          .from(table)
          .where(where)
          .limit(1);
        return {
          matches: Boolean(
            currentDesign?.liveCollaborationEnabled === true &&
            current &&
            current.html === snapshot.html &&
            current.blobHandle === snapshot.blobHandle &&
            current.updatedAt === snapshot.updatedAt &&
            current.captureRevision.toString() === snapshot.captureRevision &&
            current.publishedRevision.toString() === snapshot.publishedRevision,
          ),
          captureRevision: current?.captureRevision.toString() ?? "0",
        };
      },
    );
    if (!stillCurrent.matches) {
      return { ...empty, captureRevision: stillCurrent.captureRevision };
    }

    return {
      designId,
      fileId,
      html,
      updatedAt: snapshot.updatedAt,
      captureRevision: snapshot.captureRevision,
      publishedRevision: snapshot.publishedRevision,
      unchanged: false,
    };
  },
});
