import { defineAction, fail } from "@agent-native/core/action";
import {
  designScreenStatusRequestSchema,
  designScreenStatusSchema,
} from "@agent-native/core/shared";

import {
  loadCaptureDesign,
  loadStatusScreens,
  openCommentCount,
  screenFingerprint,
} from "../server/lib/screen-capture.js";
import "../server/db/index.js";

export default defineAction({
  description:
    "Read-only. Who can open a design (invited people, the organization, or anyone with the link), and for each named screen a fingerprint that changes when the screen does and its open comment threads. Renders nothing. Another app keeping a picture of a screen uses it to say the design moved on, to show the open comments, and to check its readers against the design's. Only other apps can call it.",
  schema: designScreenStatusRequestSchema,
  outputSchema: designScreenStatusSchema,
  readOnly: true,
  agentTool: false,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ designId, screenIds }, ctx) => {
    if (ctx?.caller !== "a2a") {
      fail(
        "get-design-screen-status reports on screens another Agent-Native app keeps pictures of. To read a design, use get-design.",
        { errorCode: "design_screen_capture_app_only", statusCode: 403 },
      );
    }
    const design = await loadCaptureDesign(designId);
    const ids = [...new Set(screenIds)];
    const screens = await loadStatusScreens(design.id, ids);
    return {
      design: {
        id: design.id,
        title: design.title,
        visibility: design.visibility,
      },
      screens: await Promise.all(
        ids
          .filter((id) => screens.get(id) !== null)
          .map(async (id) => {
            const screen = screens.get(id);
            return screen
              ? {
                  id,
                  fingerprint: screenFingerprint(screen, design.data, id),
                  openComments: await openCommentCount(design.id, id),
                }
              : { id, fingerprint: null, openComments: 0 };
          }),
      ),
    };
  },
});
