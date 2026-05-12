/**
 * Create a new organization.
 *
 * Delegates the canonical org + member + active-org-setting writes to the
 * framework `createOrganization` helper (caller becomes an `admin` in
 * `org_members`). Then seeds a Clips-specific `organization_settings`
 * sidecar row with default brand color and visibility.
 *
 * Usage:
 *   pnpm action create-organization --name="Acme"
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getDbExec, isPostgres } from "@agent-native/core/db";
import { createOrganization } from "@agent-native/core/org";
import { z } from "zod";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";

export default defineAction({
  description:
    "Create a new organization and add the caller as an admin member. Seeds a Clips-specific organization_settings row with default brand color #18181B and private visibility, then activates the new org for the caller. Returns the new organization id.",
  schema: z.object({
    name: z.string().min(1).describe("Organization name"),
  }),
  run: async (args) => {
    const ownerEmail = getCurrentOwnerEmail();

    const { id, name } = await createOrganization(
      args.name,
      ownerEmail,
      "admin",
    );

    // Clips-specific sidecar — organization_settings uses TEXT timestamps.
    const exec = getDbExec();
    const nowIso = new Date().toISOString();
    if (isPostgres()) {
      await exec.execute({
        sql: `INSERT INTO organization_settings (organization_id, brand_color, default_visibility, created_at, updated_at) VALUES (?, '#18181B', 'private', ?, ?) ON CONFLICT (organization_id) DO NOTHING`,
        args: [id, nowIso, nowIso],
      });
    } else {
      await exec.execute({
        sql: `INSERT OR IGNORE INTO organization_settings (organization_id, brand_color, default_visibility, created_at, updated_at) VALUES (?, '#18181B', 'private', ?, ?)`,
        args: [id, nowIso, nowIso],
      });
    }

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Created organization "${name}" (${id})`);

    return {
      id,
      name,
      brandColor: "#18181B",
      brandLogoUrl: null,
      createdAt: nowIso,
    };
  },
});
