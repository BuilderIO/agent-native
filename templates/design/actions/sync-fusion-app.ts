/**
 * sync-fusion-app — poll/attach the fusion branch container and refresh the
 * design's URL-backed screens once it is ready.
 *
 * This is the follow-up to `create-fusion-app`: the branch container may take
 * a while to boot, so callers poll this action until `status: "ready"`. Once
 * ready, it upserts URL-backed screens for the given (or previously placed)
 * paths pointing at the container's dev-server preview URL, so the canvas can
 * render them as live iframes.
 */

import { defineAction } from "@agent-native/core";
import { ensureFusionContainer } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  DEFAULT_FUSION_SCREEN_HEIGHT,
  DEFAULT_FUSION_SCREEN_WIDTH,
  upsertFusionScreens,
} from "../server/lib/fusion-screens.js";
import {
  FULL_APP_BUILDING_ENABLED,
  parseDesignDataBlob,
  readFusionApp,
  writeFusionApp,
} from "../shared/full-app.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function countPendingEdits(
  design: Pick<typeof schema.designs.$inferSelect, "id" | "ownerEmail">,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: count() })
    .from(schema.designFusionEdits)
    .where(
      and(
        eq(schema.designFusionEdits.designId, design.id),
        eq(schema.designFusionEdits.ownerEmail, design.ownerEmail),
        eq(schema.designFusionEdits.status, "pending"),
      ),
    );
  return row?.value ?? 0;
}

export default defineAction({
  description:
    "Poll the fusion app's container status and refresh its URL-backed " +
    "screens once ready. Call this after create-fusion-app (or periodically " +
    "while status is 'building') to pick up the live preview URL. When ready, " +
    "upserts screens for the given paths (or the design's existing fusion " +
    "screens, defaulting to '/') so the canvas iframes point at the live " +
    "container. Returns pendingEditCount so the caller knows whether queued " +
    "edits are waiting to be applied.",
  schema: z.object({
    designId: z.string().describe("Design project ID backed by a fusion app."),
    paths: z
      .array(z.string())
      .optional()
      .describe(
        "Route paths to place/refresh as screens (e.g. ['/', '/settings']). " +
          "Defaults to the design's existing fusion screen paths, or ['/'] if none exist.",
      ),
  }),
  run: async ({ designId, paths }) => {
    if (!FULL_APP_BUILDING_ENABLED) {
      throw new Error("Full app building is not enabled");
    }

    const access = await assertAccess("design", designId, "editor");
    const design = access.resource as typeof schema.designs.$inferSelect;
    const data = parseDesignDataBlob(design.data);
    const fusionApp = readFusionApp(data);
    if (!fusionApp) {
      throw new Error(
        "This design has no fusion app linkage. Call create-fusion-app first.",
      );
    }

    const result = await ensureFusionContainer({
      projectId: fusionApp.projectId,
      branchName: fusionApp.branchName,
      timeoutMs: 20_000,
    });

    const db = getDb();
    const now = new Date().toISOString();

    if (result.status === "error") {
      const nextData = writeFusionApp(data, {
        ...fusionApp,
        status: "error",
        statusMessage: result.message ?? "Container provisioning failed",
        updatedAt: now,
      });
      await db
        .update(schema.designs)
        .set({ data: JSON.stringify(nextData), updatedAt: now })
        .where(eq(schema.designs.id, designId));
      return {
        status: "error" as const,
        message: result.message ?? "Container provisioning failed",
      };
    }

    if (result.status === "provisioning") {
      const nextData = writeFusionApp(data, {
        ...fusionApp,
        status: "building",
        statusMessage: result.message ?? "Container is still starting",
        updatedAt: now,
      });
      await db
        .update(schema.designs)
        .set({ data: JSON.stringify(nextData), updatedAt: now })
        .where(eq(schema.designs.id, designId));
      return {
        status: "building" as const,
        message: result.message ?? "Container is still starting",
      };
    }

    // ready
    const previewUrl = result.url;
    if (!previewUrl) {
      throw new Error("Container reported ready but returned no preview URL");
    }

    const existingScreenMetadata = isRecord(data.screenMetadata)
      ? (data.screenMetadata as Record<string, unknown>)
      : {};
    const existingFusionPaths = Object.values(existingScreenMetadata)
      .filter(
        (entry): entry is Record<string, unknown> =>
          isRecord(entry) && entry.sourceType === "fusion",
      )
      .map((entry) => (typeof entry.path === "string" ? entry.path : undefined))
      .filter((path): path is string => Boolean(path));

    const effectivePaths =
      paths && paths.length > 0
        ? paths
        : existingFusionPaths.length > 0
          ? existingFusionPaths
          : ["/"];

    const { screens } = await upsertFusionScreens({
      designId,
      previewUrl,
      paths: effectivePaths,
      width: DEFAULT_FUSION_SCREEN_WIDTH,
      height: DEFAULT_FUSION_SCREEN_HEIGHT,
    });

    // Re-read the design's data since upsertFusionScreens just wrote it, then
    // layer the fusionApp update on top so we don't clobber the screen writes.
    const [refreshed] = await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);
    const refreshedData = parseDesignDataBlob(refreshed?.data);
    const nextData = writeFusionApp(refreshedData, {
      ...fusionApp,
      previewUrl,
      status: "ready",
      statusMessage: result.message ?? "Container is ready",
      updatedAt: now,
    });
    await db
      .update(schema.designs)
      .set({ data: JSON.stringify(nextData), updatedAt: now })
      .where(eq(schema.designs.id, designId));

    const pendingEditCount = await countPendingEdits(design);

    return {
      status: "ready" as const,
      previewUrl,
      screens: screens.map((screen) => ({
        fileId: screen.fileId,
        path: screen.path,
        url: screen.url,
        title: screen.title,
      })),
      pendingEditCount,
    };
  },
});
