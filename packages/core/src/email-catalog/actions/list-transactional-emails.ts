import { z } from "zod";

import { defineAction } from "../../action.js";
import { getAppSlug } from "../../server/app-name.js";
import { getEmailSendStats } from "../log.js";
import { listTransactionalEmails } from "../registry.js";
import { registerCoreSystemEmails } from "../system-emails.js";

const DEFAULT_WINDOW_DAYS = 30;

export default defineAction({
  description:
    "List the transactional emails this app can send, with the trigger, recipient and sender logic for each, plus local send counts and last-sent. Engagement metrics such as open rate are not included here — they live at the email provider.",
  schema: z.object({
    windowDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(DEFAULT_WINDOW_DAYS)
      .describe("How many days of send history to summarize."),
  }),
  http: { method: "GET" },
  run: async ({ windowDays }) => {
    registerCoreSystemEmails();
    const since = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const definitions = listTransactionalEmails();

    // A failed stats read must not masquerade as "no email ever sent" — the
    // catalog is still worth returning, but the caller has to be able to tell
    // that the numbers are missing rather than zero.
    let statsById: Map<string, { sent: number; failed: number; lastSentAt: number | null }> | null =
      null;
    let statsError: string | null = null;
    try {
      const stats = await getEmailSendStats(since);
      statsById = new Map(stats.map((row) => [row.templateId, row]));
    } catch (error) {
      statsError = error instanceof Error ? error.message : String(error);
    }

    return {
      app: getAppSlug() ?? null,
      windowDays,
      statsAvailable: statsError === null,
      statsError,
      emails: definitions.map((definition) => {
        const stats = statsById?.get(definition.id);
        return {
          id: definition.id,
          app: definition.app,
          name: definition.name,
          trigger: definition.trigger,
          recipient: definition.recipient,
          sender: definition.sender,
          sent: stats?.sent ?? (statsById ? 0 : null),
          failed: stats?.failed ?? (statsById ? 0 : null),
          lastSentAt: stats?.lastSentAt ?? null,
        };
      }),
    };
  },
});
