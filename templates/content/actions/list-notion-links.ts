import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { listNotionLinks } from "../server/lib/notion-sync.js";

export default defineAction({
  description: "List all documents linked to Notion pages.",
  http: false,
  run: async () => {
    const owner = getRequestUserEmail() || "local@localhost";
    const links = await listNotionLinks(owner);

    if (links.length === 0) {
      console.log("No Notion-linked documents found.");
    } else {
      for (const link of links) {
        console.log(
          `${link.title} (${link.documentId}) -> ${link.remotePageId} [${link.state}]`,
        );
      }
    }

    return links;
  },
});
