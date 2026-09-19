import { fail } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import {
  buildEmbedStartPath,
  createEmbedSessionTicket,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";
import { isSameOriginVisualEditBrowserRequest } from "./visual-edit-browser-request.js";

const VISUAL_EDIT_ACCESS_TTL_SECONDS = 5 * 60;

function visualEditPath(designId: string): string {
  return `/visual-edit/${encodeURIComponent(designId)}?editorView=overview&embedChrome=1`;
}

export default defineAction({
  description:
    "Open a public localhost visual-edit design as an editor without requiring a Design account login.",
  requiresAuth: false,
  readOnly: true,
  agentTool: false,
  mcpTool: false,
  schema: z.object({
    designId: z.string().min(1).describe("Design project ID."),
  }),
  run: async ({ designId }, ctx) => {
    if (!isSameOriginVisualEditBrowserRequest(ctx)) {
      fail(
        "Visual-edit access is available only from the same-origin Design page.",
        { errorCode: "signed_out_visual_edit_browser_required" },
      );
    }

    const [design] = await getDb()
      .select({
        id: schema.designs.id,
        data: schema.designs.data,
        ownerEmail: schema.designs.ownerEmail,
        orgId: schema.designs.orgId,
        visibility: schema.designs.visibility,
      })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);

    if (
      !design ||
      design.visibility !== "public" ||
      designSourceTypeFromData(design.data) !== "localhost"
    ) {
      fail("Only public localhost designs can be opened through visual-edit.", {
        errorCode: "visual_edit_access_unavailable",
      });
    }

    const ticket = await createEmbedSessionTicket({
      ownerEmail: design.ownerEmail,
      orgId: design.orgId,
      targetPath: visualEditPath(design.id),
      scope: `capability:visual-edit:design:${encodeURIComponent(design.id)}`,
      ttlSeconds: VISUAL_EDIT_ACCESS_TTL_SECONDS,
    });

    return { startUrl: buildEmbedStartPath(ticket.ticket) };
  },
});
