import { defineAction } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Return whether a design URL exists and whether the current viewer can access it. This reveals only existence and access metadata, never design content.",
  schema: z.object({
    designId: z.string().min(1).describe("Design ID to check."),
  }),
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: false,
  agentTool: false,
  run: async ({ designId }) => {
    const viewerEmail = getRequestUserEmail()?.trim().toLowerCase() || null;
    const viewerName = viewerEmail
      ? (getRequestUserName()?.trim() ?? null)
      : null;
    const [design] = await getDb()
      .select({
        id: schema.designs.id,
        visibility: schema.designs.visibility,
      })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);

    if (!design) {
      return {
        exists: false as const,
        hasAccess: false,
        signedIn: Boolean(viewerEmail),
        viewerEmail,
        viewerName,
        role: null,
        visibility: null,
      };
    }

    const access = await resolveAccess("design", designId);
    return {
      exists: true as const,
      hasAccess: Boolean(access),
      signedIn: Boolean(viewerEmail),
      viewerEmail,
      viewerName,
      role: access?.role ?? null,
      visibility: design.visibility ?? "private",
    };
  },
});
