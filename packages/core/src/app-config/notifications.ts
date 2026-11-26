import { z } from "zod";

export const notificationsConfig = z.object({
  usageLimitNotices: z.boolean().default(true).meta({
    env: "AGENT_NATIVE_NOTIFICATIONS_USAGE_LIMIT_NOTICES",
    doc: "When false, usage-limit alerts are not evaluated or delivered by any channel, and earlier ones are left out of the notifications inbox, its unread count, and bulk archiving. For deployments that do not meter usage.",
  }),
});
