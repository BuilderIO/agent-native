/**
 * deploy-fusion-app — reserve a hosting slug (if needed) and trigger a hosted
 * deploy of a fusion app's branch.
 *
 * On first deploy, derives a default `<slug>.builder.cloud` hosting slug from
 * the design title unless the caller passes one explicitly. Reservation
 * failures (slug already taken) surface clearly so the caller can retry with
 * a different slug. Persists the reserved slug, deployed URL, and last deploy
 * id/status on the fusion app linkage so get-fusion-deploy-status can poll
 * without re-resolving them.
 */

import { defineAction } from "@agent-native/core";
import {
  deployFusionProject,
  getFusionHostingUrl,
  reserveFusionHostingSlug,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  FULL_APP_BUILDING_ENABLED,
  parseDesignDataBlob,
  readFusionApp,
  writeFusionApp,
} from "../shared/full-app.js";

const MAX_SLUG_LENGTH = 40;

function defaultSlugFromTitle(title: string, designId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || `app-${designId.slice(0, 8)}`;
}

export default defineAction({
  description:
    "Deploy a fusion (full-app) design to a public hosted URL. Reserves a " +
    "<slug>.builder.cloud hosting slug (derived from the design title if not " +
    "already reserved and no slug is given) and triggers a hosted deploy of " +
    "the branch. If the slug is already taken, the error will say so — retry " +
    "with a different slug. Poll get-fusion-deploy-status for progress " +
    "(queued -> building -> uploading -> deploying -> live | failed).",
  schema: z.object({
    designId: z.string().describe("Design project ID backed by a fusion app."),
    slug: z
      .string()
      .optional()
      .describe(
        "Hosting slug to reserve (results in <slug>.builder.cloud). Omit to " +
          "use the design's already-reserved slug, or derive one from the title.",
      ),
  }),
  run: async ({ designId, slug }) => {
    if (!FULL_APP_BUILDING_ENABLED) {
      throw new Error("Full app building is not enabled");
    }

    const access = await assertAccess("design", designId, "editor");
    const design = access.resource as typeof schema.designs.$inferSelect;
    const fusionApp = readFusionApp(design.data);
    if (!fusionApp) {
      throw new Error(
        "This design has no fusion app linkage. Call create-fusion-app first.",
      );
    }

    const requestedSlug =
      slug?.trim() ||
      fusionApp.hostingSlug ||
      defaultSlugFromTitle(design.title, designId);

    let reservedSlug: string;
    try {
      const reservation = await reserveFusionHostingSlug({
        projectId: fusionApp.projectId,
        slug: requestedSlug,
      });
      reservedSlug = reservation.slug;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not reserve hosting slug "${requestedSlug}": ${message}. ` +
          "Pass a different slug and try again.",
      );
    }

    const deploy = await deployFusionProject({
      projectId: fusionApp.projectId,
      checkoutBranch: fusionApp.branchName,
    });

    const deployedUrl = getFusionHostingUrl(reservedSlug);
    const now = new Date().toISOString();
    const db = getDb();
    const nextData = writeFusionApp(parseDesignDataBlob(design.data), {
      ...fusionApp,
      hostingSlug: reservedSlug,
      deployedUrl,
      lastDeployId: deploy.deployId,
      lastDeployStatus: deploy.status,
      updatedAt: now,
    });
    await db
      .update(schema.designs)
      .set({ data: JSON.stringify(nextData), updatedAt: now })
      .where(eq(schema.designs.id, designId));

    return {
      deployId: deploy.deployId,
      status: deploy.status,
      url: deployedUrl,
    };
  },
});
