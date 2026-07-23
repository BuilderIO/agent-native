import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import {
  readLocalEmails,
  withLocalEmailMutationLock,
  writeLocalEmails,
} from "../server/lib/local-email-store.js";

export default defineAction({
  description:
    "Archive emails older than N days from inbox (local data only — use archive-email for Gmail-connected accounts).",
  schema: z.object({
    "older-than": z.coerce
      .number()
      .optional()
      .describe(
        "Number of days; emails older than this will be archived (default: 30)",
      ),
  }),
  http: false,
  run: async (args) => {
    const days = args["older-than"] ?? 30;
    if (isNaN(days) || days < 1)
      throw new Error("--older-than must be a positive integer (days)");

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    return withLocalEmailMutationLock(ownerEmail, async () => {
      const emails = await readLocalEmails(ownerEmail);
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
            labelIds: email.labelIds.filter((label) => label !== "inbox"),
          };
        }
        return email;
      });

      await writeLocalEmails(ownerEmail, updated);
      return `Archived ${archived} email(s) older than ${days} days (${emails.length} total)`;
    });
  },
});
