import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  assertDesignHtmlCreateIntegrity,
  isDesignHtmlIntegrityError,
} from "../shared/html-integrity.js";
import { normalizeDesignSourceType } from "../shared/source-mode.js";
import { sanitizeVisualEditSnapshotHtml } from "../shared/visual-edit-snapshot.js";
const MAX_SNAPSHOT_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertLocalhostScreenMetadata(
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

  const screenMetadata = isRecord(parsed.screenMetadata)
    ? parsed.screenMetadata
    : {};
  const localhostScreens = isRecord(parsed.localhostScreens)
    ? parsed.localhostScreens
    : {};
  const screen = isRecord(screenMetadata[fileId])
    ? screenMetadata[fileId]
    : localhostScreens[fileId];

  const screenSourceType = isRecord(screen)
    ? (normalizeDesignSourceType(screen.sourceType) ??
      (typeof screen.bridgeUrl === "string" && screen.bridgeUrl
        ? "localhost"
        : null))
    : null;
  const designSourceType =
    normalizeDesignSourceType(parsed.sourceType) ??
    normalizeDesignSourceType(parsed.sourceMode);
  if ((screenSourceType ?? designSourceType) !== "localhost") {
    fail("Only Localhost screens can publish a visual-edit snapshot.", {
      errorCode: "visual_edit_snapshot_not_localhost",
    });
  }

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
      html: z
        .string()
        .min(1)
        .max(MAX_SNAPSHOT_BYTES)
        .describe("Complete HTML snapshot captured from the running route."),
    })
    .strict(),
  run: async ({ designId, fileId, html }) => {
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

    await db
      .insert(schema.designVisualEditSnapshots)
      .values({
        designId,
        fileId,
        html: safeHtml,
        updatedAt: new Date().toISOString(),
        visibility: design.visibility,
        ownerEmail: design.ownerEmail,
        orgId: design.orgId,
      })
      .onConflictDoUpdate({
        target: [
          schema.designVisualEditSnapshots.designId,
          schema.designVisualEditSnapshots.fileId,
        ],
        set: {
          html: safeHtml,
          updatedAt: new Date().toISOString(),
          visibility: design.visibility,
          ownerEmail: design.ownerEmail,
          orgId: design.orgId,
        },
      });

    return { designId, fileId, published: true };
  },
});
