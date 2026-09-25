import { defineAction, fail } from "@agent-native/core/action";
import {
  putPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  deleteVisualEditSnapshotBlobs,
  queueVisualEditSnapshotBlobCleanupInTransaction,
} from "../server/lib/visual-edit-snapshot-blobs.js";
import { withDesignSourceMutationTransaction } from "../server/source-workspace.js";
import {
  assertDesignHtmlCreateIntegrity,
  isDesignHtmlIntegrityError,
} from "../shared/html-integrity.js";
import { designScreenSourceTypeFromData } from "../shared/source-mode.js";
import { sanitizeVisualEditSnapshotHtml } from "../shared/visual-edit-snapshot.js";
const MAX_SNAPSHOT_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function assertLocalhostScreenMetadata(
  dataJson: unknown,
  fileId: string,
  fileContent: unknown,
): string {
  if (typeof dataJson !== "string") {
    fail(
      "Design data is malformed; refusing to publish a visual-edit snapshot.",
      {
        errorCode: "malformed_design_data",
      },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataJson) as unknown;
  } catch {
    fail(
      "Design data is malformed; refusing to publish a visual-edit snapshot.",
      {
        errorCode: "malformed_design_data",
      },
    );
  }

  if (!isRecord(parsed)) {
    fail(
      "Design data is malformed; refusing to publish a visual-edit snapshot.",
      {
        errorCode: "malformed_design_data",
      },
    );
  }

  if (designScreenSourceTypeFromData(parsed, fileId) !== "localhost") {
    fail("Only Localhost screens can publish a visual-edit snapshot.", {
      errorCode: "visual_edit_snapshot_not_localhost",
    });
  }

  const screenMetadata = isRecord(parsed.screenMetadata)
    ? parsed.screenMetadata
    : {};
  const localhostScreens = isRecord(parsed.localhostScreens)
    ? parsed.localhostScreens
    : {};
  const screen = isRecord(screenMetadata[fileId])
    ? screenMetadata[fileId]
    : localhostScreens[fileId];
  const routeUrl =
    isRecord(screen) && typeof screen.url === "string"
      ? screen.url
      : isRecord(screen) && typeof screen.previewUrl === "string"
        ? screen.previewUrl
        : typeof fileContent === "string"
          ? fileContent
          : null;
  if (!routeUrl || !URL.canParse(routeUrl)) {
    fail("The Localhost screen has no valid route URL in its design data.", {
      errorCode: "visual_edit_snapshot_route_missing",
    });
  }

  const parsedRoute = new URL(routeUrl);
  if (parsedRoute.protocol !== "http:" && parsedRoute.protocol !== "https:") {
    fail("The Localhost screen route URL must use HTTP or HTTPS.", {
      errorCode: "visual_edit_snapshot_route_invalid",
    });
  }
  return parsedRoute.href;
}

export default defineAction({
  description:
    "Publish a bounded HTML fallback snapshot for one Localhost screen. Requires editor access to the Design; the live route and editable source remain unchanged.",
  requiresAuth: true,
  agentTool: false,
  mcpTool: false,
  capabilityScopes: ["visual-edit"],
  maxBodyBytes: MAX_SNAPSHOT_BYTES * 3 + 8_192,
  schema: z
    .object({
      designId: z.string().min(1).describe("Design project ID."),
      fileId: z.string().min(1).describe("Localhost screen file ID."),
      reservationToken: z
        .string()
        .regex(/^[1-9][0-9]{0,18}$/)
        .describe("Latest server-issued screen capture reservation."),
      html: z
        .string()
        .min(1)
        .max(MAX_SNAPSHOT_BYTES)
        .describe("Complete HTML snapshot captured from the running route."),
    })
    .strict(),
  run: async ({ designId, fileId, reservationToken, html }) => {
    const editorAccess = await assertAccess("design", designId, "editor");
    const design = editorAccess.resource as typeof schema.designs.$inferSelect;

    if (
      html.length > MAX_SNAPSHOT_BYTES ||
      new TextEncoder().encode(html).byteLength > MAX_SNAPSHOT_BYTES ||
      html.includes("\u0000") ||
      !html.trim() ||
      (URL.canParse(html.trim()) &&
        ["http:", "https:"].includes(new URL(html.trim()).protocol))
    ) {
      fail(
        "Visual-edit snapshot HTML is malformed or exceeds the 1 MiB limit.",
        {
          errorCode: "invalid_visual_edit_snapshot",
        },
      );
    }

    try {
      assertDesignHtmlCreateIntegrity({ content: html, fileType: "html" });
    } catch (error) {
      if (!isDesignHtmlIntegrityError(error)) throw error;
      fail("Visual-edit snapshot HTML is malformed.", {
        errorCode: "invalid_visual_edit_snapshot",
      });
    }

    const db = getDb();
    const [file] = await db
      .select({
        id: schema.designFiles.id,
        content: schema.designFiles.content,
        fileType: schema.designFiles.fileType,
      })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.id, fileId),
          eq(schema.designFiles.designId, designId),
        ),
      )
      .limit(1);

    if (!file) {
      fail("The screen does not belong to this design.", {
        errorCode: "visual_edit_snapshot_file_mismatch",
      });
    }
    if (file.fileType.toLowerCase() !== "html") {
      fail("Visual-edit snapshots can only be published for HTML screens.", {
        errorCode: "visual_edit_snapshot_not_html",
      });
    }

    assertLocalhostScreenMetadata(design.data, fileId, file.content);
    const safeHtml = sanitizeVisualEditSnapshotHtml(html);
    if (
      !safeHtml.trim() ||
      new TextEncoder().encode(safeHtml).byteLength > MAX_SNAPSHOT_BYTES
    ) {
      fail(
        "Visual-edit snapshot HTML is malformed or exceeds the 1 MiB limit.",
        {
          errorCode: "invalid_visual_edit_snapshot",
        },
      );
    }

    const revision = BigInt(reservationToken);
    if (revision > 9_223_372_036_854_775_807n) {
      fail("The visual-edit snapshot reservation is invalid.", {
        errorCode: "invalid_visual_edit_snapshot_reservation",
      });
    }

    const blob = await putPrivateBlob({
      data: Buffer.from(safeHtml, "utf8"),
      filename: "visual-edit-screen.html",
      mimeType: "text/html",
      ownerEmail:
        typeof design.ownerEmail === "string" ? design.ownerEmail : undefined,
    });
    if (!blob) {
      fail(
        "Private blob storage is not configured for visual-edit snapshots.",
        {
          errorCode: "visual_edit_snapshot_storage_unavailable",
        },
      );
    }

    const now = new Date().toISOString();
    let committed: { previousBlobHandle: string | null } | null;
    try {
      committed = await withDesignSourceMutationTransaction(
        designId,
        async (tx) => {
          const [currentDesign] = await tx
            .select({
              data: schema.designs.data,
              visibility: schema.designs.visibility,
              ownerEmail: schema.designs.ownerEmail,
              orgId: schema.designs.orgId,
            })
            .from(schema.designs)
            .where(eq(schema.designs.id, designId))
            .limit(1);
          const [currentFile] = await tx
            .select({
              content: schema.designFiles.content,
              fileType: schema.designFiles.fileType,
            })
            .from(schema.designFiles)
            .where(
              and(
                eq(schema.designFiles.id, fileId),
                eq(schema.designFiles.designId, designId),
              ),
            )
            .limit(1);
          if (
            !currentDesign ||
            !currentFile ||
            currentFile.fileType.toLowerCase() !== "html"
          ) {
            return null;
          }
          try {
            assertLocalhostScreenMetadata(
              currentDesign.data,
              fileId,
              currentFile.content,
            );
          } catch (error) {
            if (
              error &&
              typeof error === "object" &&
              "errorCode" in error &&
              error.errorCode === "visual_edit_snapshot_not_localhost"
            ) {
              return null;
            }
            throw error;
          }

          const table = schema.designVisualEditSnapshots;
          const [current] = await tx
            .select({
              blobHandle: table.blobHandle,
              captureRevision: table.captureRevision,
              publishedRevision: table.publishedRevision,
            })
            .from(table)
            .where(and(eq(table.designId, designId), eq(table.fileId, fileId)))
            .for("update")
            .limit(1);
          if (
            !current ||
            current.captureRevision !== revision ||
            current.publishedRevision >= revision
          ) {
            return null;
          }

          await queueVisualEditSnapshotBlobCleanupInTransaction(tx, [
            current.blobHandle,
          ]);

          const updated = await tx
            .update(table)
            .set({
              blobHandle: JSON.stringify(blob),
              html: "",
              publishedRevision: revision,
              updatedAt: now,
              visibility: currentDesign.visibility,
              ownerEmail: currentDesign.ownerEmail,
              orgId: currentDesign.orgId,
            })
            .where(
              and(
                eq(table.designId, designId),
                eq(table.fileId, fileId),
                eq(table.captureRevision, revision),
                sql`${table.publishedRevision} < ${revision}`,
              ),
            )
            .returning({ blobHandle: table.blobHandle });
          return updated.length
            ? { previousBlobHandle: current.blobHandle }
            : null;
        },
      );
    } catch (error) {
      await discardSnapshotBlob(blob);
      throw error;
    }

    if (!committed) {
      await discardSnapshotBlob(blob);
      return { designId, fileId, published: false };
    }

    if (
      committed.previousBlobHandle &&
      committed.previousBlobHandle !== JSON.stringify(blob)
    ) {
      await discardStoredSnapshotBlob(committed.previousBlobHandle);
    }

    return { designId, fileId, published: true };
  },
});

async function discardSnapshotBlob(blob: PrivateBlobHandle): Promise<void> {
  await deleteVisualEditSnapshotBlobs([JSON.stringify(blob)]);
}

async function discardStoredSnapshotBlob(value: string): Promise<void> {
  await deleteVisualEditSnapshotBlobs([value]);
}
