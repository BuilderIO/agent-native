import { defineAction, fail } from "@agent-native/core/action";
import {
  ensureFusionContainer,
  isFusionDevServerServing,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import "../server/db/index.js";
import { isFullAppBuildingEnabled } from "../server/lib/full-app-lab.js";
import {
  DEFAULT_FUSION_SCREEN_HEIGHT,
  DEFAULT_FUSION_SCREEN_WIDTH,
  upsertFusionScreens,
} from "../server/lib/fusion-screens.js";
import {
  parseDesignDataBlob,
  readFusionApp,
  writeFusionApp,
} from "../shared/full-app.js";

const DEV_SERVER_STARTING_MESSAGE = "Starting the dev server";

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
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  description:
    "Poll the fusion app's container status and refresh its URL-backed " +
    "screens once ready. Call this after create-builder-app (or periodically " +
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
  run: async ({ designId, paths }, ctx) => {
    if (!(await isFullAppBuildingEnabled(ctx))) {
      fail("Full app building is not enabled", {
        errorCode: "full_app_building_disabled",
        statusCode: 412,
      });
    }

    const access = await assertAccess("design", designId, "editor");
    const design = access.resource as typeof schema.designs.$inferSelect;
    const data = parseDesignDataBlob(design.data);
    const fusionApp = readFusionApp(data);
    if (!fusionApp) {
      fail("This design has no Builder app. Call create-builder-app first.", {
        errorCode: "builder_app_missing",
        statusCode: 412,
      });
    }

    // A local session's app runs on the user's machine, not in a container.
    if (fusionApp.projectId === "local") {
      return {
        status: fusionApp.status,
        ...(fusionApp.previewUrl ? { previewUrl: fusionApp.previewUrl } : {}),
        pendingEditCount: await countPendingEdits(design),
      };
    }

    const ensureStartedAt = Date.now();
    const container = await ensureFusionContainer({
      projectId: fusionApp.projectId,
      branchName: fusionApp.branchName,
      timeoutMs: 20_000,
    }).catch((err: unknown) => ({
      // Reaching Builder failed (e.g. this caller has no Builder
      // credentials): a failed check, not a failed app.
      status: "error" as const,
      message: err instanceof Error ? err.message : String(err),
      errorSource: "request" as const,
    }));
    // The container is up before its dev server serves, and a screen loaded
    // in between never gets the editor bridge: it is still starting until then.
    const result =
      container.status === "ready" &&
      container.url &&
      !(await isFusionDevServerServing(container.url))
        ? {
            status: "provisioning" as const,
            message: DEV_SERVER_STARTING_MESSAGE,
          }
        : container;
    console.info("[sync-builder-app] container", {
      projectId: fusionApp.projectId,
      status: result.status,
      ensureMs: Date.now() - ensureStartedAt,
    });

    const now = new Date().toISOString();
    // The container check can take 20 s. If the app changed meanwhile (another
    // sync found it ready), a failure or "still starting" seen here is stale.
    const isSuperseded = (current: Record<string, unknown>) =>
      readFusionApp(current)?.updatedAt !== fusionApp.updatedAt;

    if (result.status === "error") {
      const statusMessage = result.message ?? "Container provisioning failed";
      // Only the container failing marks the app failed for everyone. A
      // failed request (e.g. this caller's Builder credentials), or any
      // error over an app that was working, is this caller's to see.
      if (result.errorSource !== "container" || fusionApp.status === "ready") {
        return { status: "error" as const, message: statusMessage };
      }
      await mutateDesignData({
        designId,
        mutate: (current) =>
          isSuperseded(current)
            ? current
            : writeFusionApp(current, {
                ...(readFusionApp(current) ?? fusionApp),
                status: "error",
                statusMessage,
                updatedAt: now,
              }),
        isApplied: (current) => {
          if (isSuperseded(current)) return true;
          const persisted = readFusionApp(current);
          return (
            persisted?.status === "error" &&
            persisted.statusMessage === statusMessage
          );
        },
      });
      return {
        status: "error" as const,
        message: statusMessage,
      };
    }

    if (result.status === "provisioning") {
      const statusMessage = result.message ?? "Container is still starting";
      const alreadyStarting =
        fusionApp.status === "building" &&
        fusionApp.statusMessage === statusMessage;
      if (!alreadyStarting)
        await mutateDesignData({
          designId,
          mutate: (current) =>
            isSuperseded(current)
              ? current
              : writeFusionApp(current, {
                  ...(readFusionApp(current) ?? fusionApp),
                  status: "building",
                  statusMessage,
                  updatedAt: now,
                }),
          isApplied: (current) => {
            if (isSuperseded(current)) return true;
            const persisted = readFusionApp(current);
            return (
              persisted?.status === "building" &&
              persisted.statusMessage === statusMessage
            );
          },
        });
      return {
        status: "building" as const,
        message: statusMessage,
      };
    }

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

    const statusMessage = result.message ?? "Container is ready";
    const alreadyReady =
      fusionApp.status === "ready" &&
      fusionApp.previewUrl === previewUrl &&
      fusionApp.statusMessage === statusMessage;
    if (!alreadyReady)
      await mutateDesignData({
        designId,
        mutate: (current) =>
          writeFusionApp(current, {
            ...(readFusionApp(current) ?? fusionApp),
            previewUrl,
            status: "ready",
            statusMessage,
            updatedAt: now,
          }),
        isApplied: (current) => {
          const persisted = readFusionApp(current);
          return (
            persisted?.previewUrl === previewUrl &&
            persisted.status === "ready" &&
            persisted.statusMessage === statusMessage
          );
        },
      });

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
