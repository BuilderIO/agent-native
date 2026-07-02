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
import { createOrganization } from "@agent-native/core/org";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
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
    const nowIso = new Date().toISOString();
    await getDb()
      .insert(schema.organizationSettings)
      .values({
        organizationId: id,
        brandColor: "#18181B",
        defaultVisibility: "private",
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing();

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
