import { defineAction } from "@agent-native/core/action";
import { toAbsoluteOpenUrl, buildDeepLink } from "@agent-native/core/server";
import { getRequestContext } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Get a Design shared-canvas link, public preview URL mappings, and whether shared live previews are enabled. Requires viewer access; viewers get mappings only while live previews are enabled. Use get-visual-edit-pending for source suggestions.",
  schema: z.object({
    designId: z.string().min(1).describe("Design project ID."),
  }),
  readOnly: true,
  requiresAuth: false,
  http: { method: "GET" },
  run: async ({ designId }) => {
    const access = await assertAccess("design", designId, "viewer");
    const design = access.resource as typeof schema.designs.$inferSelect;
    const enabled = design.liveCollaborationEnabled === true;
    // Disabling live previews revokes them; editors keep theirs to manage.
    const showPreviews =
      enabled || ["owner", "admin", "editor"].includes(access.role);
    const data = JSON.parse(design.data) as {
      screenMetadata?: Record<string, { tunnelUrl?: string }>;
    };
    return {
      designId,
      shareUrl: toAbsoluteOpenUrl(
        buildDeepLink({
          app: "design",
          view: "editor",
          params: { designId },
          to: `/visual-edit/${encodeURIComponent(designId)}?share=1&editorView=overview`,
        }),
        getRequestContext()?.requestOrigin ?? "https://design.agent-native.com",
      ),
      previews: showPreviews
        ? Object.entries(data.screenMetadata ?? {})
            .filter(([, screen]) => typeof screen.tunnelUrl === "string")
            .map(([fileId, screen]) => ({
              fileId,
              tunnelUrl: screen.tunnelUrl,
            }))
        : [],
      enabled,
    };
  },
});
