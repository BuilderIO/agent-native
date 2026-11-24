import {
  AgentInvocationError,
  readPeerLinkSummaries,
} from "@agent-native/core/a2a";
import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  UNAVAILABLE_LINK_SUMMARY,
  linkSummarySchema,
} from "@agent-native/core/shared";
import { z } from "zod";

import {
  resolveContentPeer,
  type ContentPeer,
} from "../server/lib/content-peer.js";
import {
  DESIGN_BRIEF_LIMIT,
  designBriefSchema,
} from "../shared/design-briefs.js";

const CONTENT_TIMEOUT_MS = 15_000;

export default defineAction({
  description:
    "Titles and links of the Content pages a design was built from, asked of Content as the signed-in reader. Each answer is the page's title when the reader can open it, otherwise only unavailable. Nothing is cached or stored.",
  schema: z.object({
    ids: z
      .array(designBriefSchema.shape.id)
      .min(1)
      .max(DESIGN_BRIEF_LIMIT)
      .describe("The Content page ids the design keeps as its briefs."),
  }),
  outputSchema: z.object({
    summaries: z
      .array(linkSummarySchema)
      .describe("One answer per id, in the request's order."),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  persistInBrowser: false,
  run: async ({ ids }) => {
    const unavailable = {
      summaries: ids.map(() => UNAVAILABLE_LINK_SUMMARY),
    };
    if (!getRequestUserEmail()) return unavailable;
    let content: ContentPeer;
    try {
      content = await resolveContentPeer();
    } catch (error) {
      if (
        !(error instanceof AgentInvocationError) ||
        error.code !== "not-found"
      )
        throw error;
      console.warn("[read-brief-titles] could not find Content", {
        error: error.message,
      });
      return unavailable;
    }
    return {
      summaries: await readPeerLinkSummaries({
        app: "content",
        links: ids.map(
          (id) => `${content.appUrl}/page/${encodeURIComponent(id)}`,
        ),
        selfAppId: "design",
        target: content.target,
        timeoutMs: CONTENT_TIMEOUT_MS,
      }),
    };
  },
});
