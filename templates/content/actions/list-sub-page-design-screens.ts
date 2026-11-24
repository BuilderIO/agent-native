import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { designScreenSchema } from "../shared/design-screen-block.js";
import { designScreensInBody } from "../shared/design-screens-in-body.js";
import { designScreenDocumentIdSchema } from "./_design-screen-access.js";
import { readSubPagesGoingPublic } from "./_sub-pages-going-public.js";

const subPageScreenSchema = designScreenSchema.pick({
  screen: true,
  design: true,
});

export default defineAction({
  description:
    "For a page you can share: the Design screens pinned in the sub-pages that would go public with it, so the share dialog can ask before they reach more people than their designs. Reads saved pages only.",
  schema: z.object({ documentId: designScreenDocumentIdSchema }),
  outputSchema: z.object({
    screens: z.array(subPageScreenSchema),
    unreadable: z.number(),
    more: z.boolean(),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async ({ documentId }) => {
    const { found, more } = await readSubPagesGoingPublic(
      documentId,
      designScreensInBody,
    );
    const screens: z.infer<typeof subPageScreenSchema>[] = [];
    let unreadable = 0;
    for (const page of found) {
      unreadable += page.unreadable;
      for (const screen of page.screens) {
        screens.push({ screen: screen.screen, design: screen.design });
      }
    }
    return { screens, unreadable, more };
  },
});
