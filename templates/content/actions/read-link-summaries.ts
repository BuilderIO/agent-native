import { readPeerLinkSummaries } from "@agent-native/core/a2a";
import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import {
  LINK_SUMMARY_APPS,
  LINK_SUMMARY_MAX_LINKS,
  LINK_SUMMARY_URL_CHARS,
  UNAVAILABLE_LINK_SUMMARY,
  linkSummaryItemFromUrl,
  linkSummarySchema,
  type LinkSummary,
  type LinkSummaryApp,
} from "@agent-native/core/shared";
import { z } from "zod";

import { peerLinkOrigins } from "../server/lib/app-peer.js";

const MAX_LINKS = 60;

export default defineAction({
  description:
    "Titles for the link cards on a page, asked of Design, Slides and Clips as the signed-in reader. Each answer is the item's title when the reader can open it, otherwise only unavailable; a link to any other site is unavailable. Nothing is cached or stored.",
  schema: z.object({
    links: z
      .array(z.string().max(LINK_SUMMARY_URL_CHARS))
      .min(1)
      .max(MAX_LINKS)
      .describe("The cards' links, as stored in the page."),
  }),
  outputSchema: z.object({
    reader: z.string().nullable(),
    summaries: z.array(linkSummarySchema),
  }),
  http: { method: "POST" },
  readOnly: true,
  agentTool: false,
  run: async ({ links }) => {
    const reader = getRequestUserEmail() ?? null;
    const appUrls = Object.fromEntries(
      LINK_SUMMARY_APPS.map((app) => [app, peerLinkOrigins(app)]),
    );
    const byApp = new Map<
      LinkSummaryApp,
      Array<{ index: number; link: string }>
    >();
    links.forEach((link, index) => {
      const item = linkSummaryItemFromUrl(link, appUrls);
      if (!item) return;
      byApp.set(item.app, [...(byApp.get(item.app) ?? []), { index, link }]);
    });
    const summaries: LinkSummary[] = links.map(() => UNAVAILABLE_LINK_SUMMARY);
    const requests: Promise<void>[] = [];
    for (const [app, entries] of byApp) {
      for (
        let start = 0;
        start < entries.length;
        start += LINK_SUMMARY_MAX_LINKS
      ) {
        const batch = entries.slice(start, start + LINK_SUMMARY_MAX_LINKS);
        requests.push(
          readPeerLinkSummaries({
            app,
            links: batch.map((entry) => entry.link),
            selfAppId: "content",
          }).then((answers) => {
            batch.forEach((entry, position) => {
              summaries[entry.index] =
                answers[position] ?? UNAVAILABLE_LINK_SUMMARY;
            });
          }),
        );
      }
    }
    await Promise.all(requests);
    return { reader, summaries };
  },
});
