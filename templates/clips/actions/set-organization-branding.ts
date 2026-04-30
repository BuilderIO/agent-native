/**
 * Update organization branding — brand color, brand logo URL, default
 * visibility — by upserting the Clips-specific `organization_settings`
 * sidecar row. Does NOT change the core better-auth `organization` row.
 *
 * Usage:
 *   pnpm action set-organization-branding --brandColor="#18181B" --brandLogoUrl=/api/media/abc.png
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { z } from "zod";
import { requireOrganizationAccess } from "../server/lib/recordings.js";

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
    const exec = getDbExec();
    const pg = isPostgres();

    const { organizationId } = await requireOrganizationAccess(
      args.organizationId,
      ["admin"],
    );

    // Ensure a settings row exists. Clips' own organization_settings table is
    // dialect-agnostic — schema.ts declares created_at/updated_at as TEXT with
    // an ISO default, so we use ISO strings on both PG and SQLite.
    const nowIso = new Date().toISOString();
    if (pg) {
      await exec.execute({
        sql: `INSERT INTO organization_settings (organization_id, brand_color, default_visibility, created_at, updated_at) VALUES ($1, '#18181B', 'private', $2, $3) ON CONFLICT (organization_id) DO NOTHING`,
        args: [organizationId, nowIso, nowIso],
      });
    } else {
      await exec.execute({
        sql: `INSERT OR IGNORE INTO organization_settings (organization_id, brand_color, default_visibility, created_at, updated_at) VALUES (?, '#18181B', 'private', ?, ?)`,
        args: [organizationId, nowIso, nowIso],
      });
    }

    // Build the UPDATE dynamically — only patch fields that were passed.
    const setClauses: string[] = [];
    const values: any[] = [];
    let argIdx = 1;

    if (typeof args.brandColor === "string") {
      setClauses.push(pg ? `brand_color = $${argIdx++}` : `brand_color = ?`);
      values.push(args.brandColor);
    }
    if (args.brandLogoUrl !== undefined) {
      setClauses.push(
        pg ? `brand_logo_url = $${argIdx++}` : `brand_logo_url = ?`,
      );
      values.push(args.brandLogoUrl ?? null);
    }
    if (typeof args.defaultVisibility === "string") {
      setClauses.push(
        pg ? `default_visibility = $${argIdx++}` : `default_visibility = ?`,
      );
      values.push(args.defaultVisibility);
    }

    if (setClauses.length) {
      setClauses.push(pg ? `updated_at = $${argIdx++}` : `updated_at = ?`);
      values.push(nowIso);
      values.push(organizationId);
      const whereSql = pg
        ? `WHERE organization_id = $${argIdx}`
        : `WHERE organization_id = ?`;
      await exec.execute({
        sql: `UPDATE organization_settings SET ${setClauses.join(", ")} ${whereSql}`,
        args: values,
      });
    }

    // Return the current values.
    const res = await exec.execute({
      sql: pg
        ? `SELECT organization_id, brand_color, brand_logo_url, default_visibility, updated_at FROM organization_settings WHERE organization_id = $1 LIMIT 1`
        : `SELECT organization_id, brand_color, brand_logo_url, default_visibility, updated_at FROM organization_settings WHERE organization_id = ? LIMIT 1`,
      args: [organizationId],
    });
    const row = (
      res.rows as Array<{
        organization_id: string;
        brand_color: string;
        brand_logo_url: string | null;
        default_visibility: string;
        updated_at: string | null;
      }>
    )[0];

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Updated branding for organization ${organizationId}`);

    return {
      organizationId,
      brandColor: row?.brand_color ?? "#18181B",
      brandLogoUrl: row?.brand_logo_url ?? null,
      defaultVisibility: row?.default_visibility ?? "private",
      updatedAt: row?.updated_at ?? nowIso,
    };
  },
});
