/**
 * Create a new workspace. Inserts a workspace row, adds the caller as the
 * first admin member, and sets the new workspace as active.
 *
 * Usage:
 *   pnpm action create-workspace --name="Acme"
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
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
import { writeAppState, readAppState } from "@agent-native/core/application-state";

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default defineAction({
  description:
    "Create a new workspace and add the caller as the first admin member. Sets it as the current workspace via application state so the UI scopes immediately.",
  schema: z.object({
    name: z.string().min(1).describe("Workspace name"),
    slug: z
      .string()
      .optional()
      .describe(
        "URL slug (lowercase, dashes). Auto-generated from the name when omitted.",
      ),
    brandColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/)
      .optional()
      .describe("Initial brand color (hex) — defaults to monochrome #111111"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = nanoid();
    const now = new Date().toISOString();
    const brandColor = args.brandColor ?? "#111111";

    let slug =
      slugify(args.slug || args.name) || `ws-${id.slice(0, 6).toLowerCase()}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const [collision] = await db
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.slug, slug))
        .limit(1);
      if (!collision) break;
      slug = `${slugify(args.slug || args.name) || "ws"}-${nanoid(4).toLowerCase()}`;
    }

    await db.insert(schema.workspaces).values({
      id,
      name: args.name.trim(),
      slug,
      brandColor,
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.workspaceMembers).values({
      id: nanoid(),
      workspaceId: id,
      email: ownerEmail,
      role: "admin",
      invitedAt: now,
      joinedAt: now,
    });

    await writeAppState("current-workspace", {
      id,
      name: args.name.trim(),
      slug,
      brandColor,
    });
    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Created workspace "${args.name}" (${id})`);

    return {
      id,
      name: args.name.trim(),
      slug,
      brandColor,
      brandLogoUrl: null,
      ownerEmail,
      createdAt: now,
    };
  },
});

void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void readAppState;
void accessFilter;
void assertAccess;
