/**
 * Update organization branding — brand color, brand logo URL, default
 * visibility — by upserting the Clips-specific `organization_settings`
 * sidecar row. Does NOT change the framework `organizations` row.
 *
 * Usage:
 *   pnpm action set-organization-branding --brandColor="#18181B" --brandLogoUrl=/api/media/abc.png
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";
import { requireOrganizationAccess } from "../server/lib/recordings.js";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

const VisibilityEnum = z.enum(["private", "org", "public"]);

export default defineAction({
  description:
    "Update the active organization's Clips branding — brand color (e.g. #18181B), brand logo URL, and default recording visibility. Upserts the organization_settings sidecar row.",
  schema: z.object({
    organizationId: z
      .string()
      .optional()
      .describe("Organization id (defaults to the caller's active org)"),
    brandColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/)
      .optional()
      .describe("Hex color (e.g. #18181B)"),
    brandLogoUrl: z
      .string()
      .nullish()
      .describe("URL of the logo image — pass null to clear"),
    defaultVisibility: VisibilityEnum.optional().describe(
      "Default visibility for new recordings",
    ),
  }),
  run: async (args) => {
    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
      ["admin"],
    );

    // Ensure a settings row exists. Clips' own organization_settings table is
    // dialect-agnostic — schema.ts declares created_at/updated_at as TEXT with
    // an ISO default, so we use ISO strings on both PG and SQLite.
    const db = getDb();
    const nowIso = new Date().toISOString();
    await db
      .insert(schema.organizationSettings)
      .values({
        organizationId,
        brandColor: "#18181B",
        defaultVisibility: "private",
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing();

    // Build the UPDATE dynamically — only patch fields that were passed.
    const updates: Partial<typeof schema.organizationSettings.$inferInsert> =
      {};

    if (typeof args.brandColor === "string") {
      updates.brandColor = args.brandColor;
    }
    if (args.brandLogoUrl !== undefined) {
      updates.brandLogoUrl = args.brandLogoUrl ?? null;
    }
    if (typeof args.defaultVisibility === "string") {
      updates.defaultVisibility = args.defaultVisibility;
    }

    if (Object.keys(updates).length) {
      await db
        .update(schema.organizationSettings)
        .set({ ...updates, updatedAt: nowIso })
        .where(eq(schema.organizationSettings.organizationId, organizationId));
    }

    // Return the current values.
    const [row] = await db
      .select({
        organizationId: schema.organizationSettings.organizationId,
        brandColor: schema.organizationSettings.brandColor,
        brandLogoUrl: schema.organizationSettings.brandLogoUrl,
        defaultVisibility: schema.organizationSettings.defaultVisibility,
        updatedAt: schema.organizationSettings.updatedAt,
      })
      .from(schema.organizationSettings)
      .where(eq(schema.organizationSettings.organizationId, organizationId))
      .limit(1);

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Updated branding for organization ${organizationId}`);

    return {
      organizationId,
      brandColor: row?.brandColor ?? "#18181B",
      brandLogoUrl: row?.brandLogoUrl ?? null,
      defaultVisibility: row?.defaultVisibility ?? "private",
      updatedAt: row?.updatedAt ?? nowIso,
    };
  },
});
