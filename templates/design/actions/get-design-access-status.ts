import { defineAction } from "@agent-native/core/action";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";

export default defineAction({
  description:
    "Return whether a design URL is readable by the current viewer. Anonymous viewers receive no existence signal, and the action never returns design content.",
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
    if (!viewerEmail) {
      return {
        exists: false as const,
        hasAccess: false,
        signedIn: false,
        viewerEmail: null,
        viewerName: null,
        role: null,
        visibility: null,
      };
    }
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
        signedIn: true,
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
