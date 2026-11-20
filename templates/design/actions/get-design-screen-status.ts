import { defineAction } from "@agent-native/core/action";
import {
  designScreenStatusRequestSchema,
  designScreenStatusSchema,
} from "@agent-native/core/shared";

import {
  loadCaptureDesign,
  loadCaptureScreens,
  openCommentCount,
  screenFingerprint,
} from "../server/lib/screen-capture.js";
import "../server/db/index.js";

export default defineAction({
  description:
    "Read-only. Who can open a design (invited people, the organization, or anyone with the link), and for each named screen a fingerprint that changes when the screen does and its open comment threads. Renders nothing. Another app keeping a picture of a screen uses it to say the design moved on, to show the open comments, and to check its readers against the design's.",
  schema: designScreenStatusRequestSchema,
  outputSchema: designScreenStatusSchema,
  readOnly: true,
  agentTool: false,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ designId, screenIds }) => {
    const design = await loadCaptureDesign(designId);
    const ids = [...new Set(screenIds)];
    const screens = await loadCaptureScreens(design.id, ids);
    return {
      design: {
        id: design.id,
        title: design.title,
        visibility: design.visibility,
      },
      screens: await Promise.all(
        ids.map(async (id) => {
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
