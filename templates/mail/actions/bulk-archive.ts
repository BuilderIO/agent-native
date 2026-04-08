import { defineAction } from "@agent-native/core";
import { getSetting, putSetting } from "@agent-native/core/settings";

export default defineAction({
  description:
    "Archive emails older than N days from inbox (local data only — use archive-email for Gmail-connected accounts).",
  parameters: {
    "older-than": {
      type: "string",
      description:
        "Number of days; emails older than this will be archived (default: 30)",
    },
  },
  http: false,
  run: async (args) => {
    const days = args["older-than"] ? parseInt(args["older-than"], 10) : 30;
    if (isNaN(days) || days < 1)
      return "Error: --older-than must be a positive integer (days)";

    const data = await getSetting("local-emails");
    if (!data || !Array.isArray((data as any).emails)) {
      return "Error: No local emails data found. This tool only works with local data.";
    }

    const emails: any[] = (data as any).emails;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let archived = 0;
    const updated = emails.map((email) => {
      if (
        !email.isArchived &&
        !email.isTrashed &&
        !email.isDraft &&
        new Date(email.date).getTime() < cutoff
      ) {
        archived++;
        return {
          ...email,
          isArchived: true,
          labelIds: email.labelIds.filter((l: string) => l !== "inbox"),
        };
      }
      return email;
    });

    await putSetting("local-emails", { emails: updated });
    return `Archived ${archived} email(s) older than ${days} days (${emails.length} total)`;
  },
});
