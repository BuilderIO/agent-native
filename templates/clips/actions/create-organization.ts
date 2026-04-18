/**
 * Create a new organization.
 *
 * Inserts a better-auth `organization` row, adds the caller as an `admin` in
 * `member`, and seeds a Clips-specific `organization_settings` sidecar row
 * (default brand color and visibility). Returns the new org id so the client
 * can switch to it via `setActiveOrganization`.
 *
 * Usage:
 *   pnpm action create-organization --name="Acme"
 *   pnpm action create-organization --name="Acme" --slug=acme
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { z } from "zod";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/recordings.js";

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function slugExists(slug: string): Promise<boolean> {
  const exec = getDbExec();
  const sql = isPostgres()
    ? `SELECT id FROM organization WHERE slug = $1 LIMIT 1`
    : `SELECT id FROM organization WHERE slug = ? LIMIT 1`;
  const res = await exec.execute({ sql, args: [slug] });
  return (res.rows as any[]).length > 0;
}

async function resolveUserId(email: string): Promise<string | null> {
  const exec = getDbExec();
  try {
    const sql = isPostgres()
      ? `SELECT id FROM "user" WHERE email = $1 LIMIT 1`
      : `SELECT id FROM user WHERE email = ? LIMIT 1`;
    const res = await exec.execute({ sql, args: [email] });
    const row = (res.rows as Array<{ id?: string }>)[0];
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export default defineAction({
  description:
    "Create a new organization and add the caller as an admin member. Seeds a Clips-specific organization_settings row with default brand color #18181B and private visibility. Returns the new organization id so the client can activate it via setActiveOrganization.",
  schema: z.object({
    name: z.string().min(1).describe("Organization name"),
    slug: z
      .string()
      .optional()
      .describe(
        "URL slug (lowercase, dashes). Auto-generated from the name when omitted.",
      ),
  }),
  run: async (args) => {
    const exec = getDbExec();
    const ownerEmail = getCurrentOwnerEmail();
    const id = nanoid();
    const pg = isPostgres();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // Resolve a unique slug — retry with a short suffix on collision.
    const base =
      slugify(args.slug || args.name) || `org-${id.slice(0, 6).toLowerCase()}`;
    let slug = base;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!(await slugExists(slug))) break;
      slug = `${base}-${nanoid(4).toLowerCase()}`;
    }

    // Insert the better-auth organization row.
    if (pg) {
      await exec.execute({
        sql: `INSERT INTO organization (id, name, slug, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
        args: [id, args.name.trim(), slug],
      });
    } else {
      await exec.execute({
        sql: `INSERT INTO organization (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        args: [id, args.name.trim(), slug, nowMs, nowMs],
      });
    }

    // Add the caller as an admin member — resolve user id if we can, else
    // fall back to the email string (useful in dev where the user table may
    // be bypassed by auth-skip).
    const userId = (await resolveUserId(ownerEmail)) ?? ownerEmail;
    const memberId = nanoid();
    if (pg) {
      await exec.execute({
        sql: `INSERT INTO member (id, organization_id, user_id, role, created_at, updated_at) VALUES ($1, $2, $3, 'admin', NOW(), NOW())`,
        args: [memberId, id, userId],
      });
    } else {
      await exec.execute({
        sql: `INSERT INTO member (id, organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, 'admin', ?, ?)`,
        args: [memberId, id, userId, nowMs, nowMs],
      });
    }

    // Seed the Clips-specific sidecar. Our own organization_settings table
    // was declared in schema.ts with TEXT created_at/updated_at so ISO
    // strings are the right choice on both dialects.
    if (pg) {
      await exec.execute({
        sql: `INSERT INTO organization_settings (organization_id, brand_color, default_visibility, created_at, updated_at) VALUES ($1, '#18181B', 'private', $2, $3) ON CONFLICT (organization_id) DO NOTHING`,
        args: [id, nowIso, nowIso],
      });
    } else {
      await exec.execute({
        sql: `INSERT OR IGNORE INTO organization_settings (organization_id, brand_color, default_visibility, created_at, updated_at) VALUES (?, '#18181B', 'private', ?, ?)`,
        args: [id, nowIso, nowIso],
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Created organization "${args.name}" (${id})`);

    return {
      id,
      name: args.name.trim(),
      slug,
      brandColor: "#18181B",
      brandLogoUrl: null,
      createdAt: nowIso,
    };
  },
});
