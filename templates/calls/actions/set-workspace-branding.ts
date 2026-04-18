/**
 * Update a workspace's branding — brandColor (monochrome default) and
 * brandLogoUrl. Admin-only.
 *
 * Usage:
 *   pnpm action set-workspace-branding --workspaceId=<id> --brandColor="#111111" --brandLogoUrl=/api/media/abc.png
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

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
    "Update workspace branding — brandColor (monochrome hex, default #111111) and brandLogoUrl. Admin-only.",
  schema: z.object({
    workspaceId: z.string().describe("Workspace id"),
    brandColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/)
      .optional()
      .describe("Hex color (default stays monochrome #111111)"),
    brandLogoUrl: z
      .string()
      .nullish()
      .describe("URL of the logo image — pass null to clear"),
    name: z
      .string()
      .min(1)
      .optional()
      .describe("Rename the workspace at the same time"),
  }),
  http: { method: "POST" },
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
      .where(eq(schema.workspaces.id, args.workspaceId))
      .limit(1);

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

void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
void assertAccess;
