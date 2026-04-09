import { defineAction } from "@agent-native/core";
import { getSetting } from "@agent-native/core/settings";
import { z } from "zod";

export default defineAction({
  description: "Export emails for a given view as JSON.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe(
        "View to export (inbox, starred, sent, drafts, archive, trash, all). Default: inbox",
      ),
  }),
  http: false,
  run: async (args) => {
    const view = args.view ?? "inbox";

    const data = await getSetting("local-emails");
    const emails: any[] =
      data && Array.isArray((data as any).emails) ? (data as any).emails : [];

    let filtered = emails;
    switch (view) {
      case "inbox":
        filtered = emails.filter(
          (e) => !e.isArchived && !e.isTrashed && !e.isDraft && !e.isSent,
        );
        break;
      case "starred":
        filtered = emails.filter((e) => e.isStarred && !e.isTrashed);
        break;
      case "sent":
        filtered = emails.filter((e) => e.isSent);
        break;
      case "drafts":
        filtered = emails.filter((e) => e.isDraft);
        break;
      case "archive":
        filtered = emails.filter((e) => e.isArchived && !e.isTrashed);
        break;
      case "trash":
        filtered = emails.filter((e) => e.isTrashed);
        break;
      case "all":
        break;
      default:
        return `Error: Unknown view "${view}". Valid: inbox, starred, sent, drafts, archive, trash, all`;
    }

    return JSON.stringify(filtered, null, 2);
  },
});
