/**
 * Update workspace branding — name, brand color, brand logo URL.
 * Admin-only.
 *
 * Usage:
 *   pnpm action set-workspace-branding --workspaceId=<id> --brandColor="#625DF5" --brandLogoUrl=/api/media/abc.png --name="Acme"
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";

async function assertCallerIsAdmin(workspaceId: string, email: string) {
  const db = getDb();
  const [member] = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.email, email),
      ),
    );
  if (member && member.role === "admin") return;
  const [ws] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));
  if (!ws) throw new Error(`Workspace not found: ${workspaceId}`);
  if (ws.ownerEmail === email) return;
  throw new Error("Only workspace admins can change branding.");
}

export default defineAction({
  description:
    "Update a workspace's branding — name, brand color, and/or brand logo URL. Admin-only.",
  schema: z.object({
    workspaceId: z.string().describe("Workspace id"),
    brandColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/)
      .optional()
      .describe("Hex color (e.g. #625DF5)"),
    brandLogoUrl: z
      .string()
      .nullish()
      .describe("URL of the logo image — pass null to clear"),
    name: z.string().min(1).optional().describe("Rename the workspace"),
  }),
  run: async (args) => {
    const db = getDb();
    const caller = getCurrentOwnerEmail();
    await assertCallerIsAdmin(args.workspaceId, caller);

    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (typeof args.brandColor === "string") patch.brandColor = args.brandColor;
    if (args.brandLogoUrl !== undefined)
      patch.brandLogoUrl = args.brandLogoUrl ?? null;
    if (typeof args.name === "string") patch.name = args.name.trim();

    await db
      .update(schema.workspaces)
      .set(patch)
      .where(eq(schema.workspaces.id, args.workspaceId));

    const [updated] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, args.workspaceId));

    // Keep `current-workspace` in sync if this is the active workspace.
    if (updated) {
      await writeAppState("current-workspace", {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        brandColor: updated.brandColor,
        brandLogoUrl: updated.brandLogoUrl,
      });
    }
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Updated branding for workspace ${args.workspaceId}`);
    return {
      id: updated?.id,
      name: updated?.name,
      brandColor: updated?.brandColor,
      brandLogoUrl: updated?.brandLogoUrl,
    };
  },
});
