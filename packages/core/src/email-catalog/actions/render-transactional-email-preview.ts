import { z } from "zod";

import { defineAction } from "../../action.js";
import { renderTransactionalEmailPreview } from "../registry.js";
import { registerCoreSystemEmails } from "../system-emails.js";

export default defineAction({
  description:
    "Render one of this app's transactional emails with representative dummy data, returning the subject, HTML and plain-text bodies for preview.",
  schema: z.object({
    id: z
      .string()
      .describe("Registered email id, e.g. calendar.booking-confirmed."),
  }),
  http: { method: "GET" },
  run: async ({ id }) => {
    registerCoreSystemEmails();
    const rendered = renderTransactionalEmailPreview(id);
    return {
      id,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    };
  },
});
