import { z } from "zod";

import { defineAction } from "../../action.js";
import { getAppConfig } from "../../app-config/index.js";
import { getRequestOrgId } from "../../server/request-context.js";
import { authorizeTransactionalEmailRead } from "../authorize.js";
import { getEmailLogEntryBody } from "../log.js";

export default defineAction({
  description:
    "Fetch the rendered HTML/text body that was sent for one transactional email send-log row, given its id from list-email-log. Sensitive content (magic links, reset links, OTP codes) is already redacted in the stored body. Kept separate from list-email-log because bodies are large and a list page can hold up to 500 rows.",
  schema: z.object({
    id: z.string().describe("The send-log row id, from list-email-log."),
  }),
  http: { method: "GET" },
  authorize: () => authorizeTransactionalEmailRead(),
  run: async ({ id }) => {
    const entry = await getEmailLogEntryBody({
      orgId: getRequestOrgId() ?? "",
      app: getAppConfig().app.slug ?? "unknown",
      id,
    });
    // `null` here means no row matched this id in this org/app scope — a
    // stale id or an access-scope mismatch. That must stay distinguishable
    // from a real row whose body columns are legitimately null (e.g. a
    // legacy send from before this feature existed), which
    // `getEmailLogEntryBody` returns as `{ htmlBody: null, textBody: null }`,
    // not `null`. Silently returning the same empty-body shape for both
    // would hide an authorization/data-integrity failure as an ordinary
    // "nothing to show".
    if (!entry) {
      throw new Error("Email log entry not found");
    }
    return entry;
  },
});
