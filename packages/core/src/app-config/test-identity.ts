import { z } from "zod";

export const testIdentityConfig = z.object({
  emails: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(
          /^(?:[a-z0-9._%+-]+)?@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/,
          "Use an exact address (qa@corp.com) or an @domain entry (@qa.corp.com).",
        ),
    )
    .default([])
    .meta({
      env: "AGENT_NATIVE_TEST_IDENTITY_EMAILS",
      doc: "Extra test identities, on top of the built-in reserved TLDs (.test, .invalid, .localhost, .example) and QA markers (+autoz). Comma-separated exact addresses (qa@corp.com) or @domain entries (@qa.corp.com, which also matches subdomains). Test identities still sign in and run every flow; they are excluded from metrics and from non-auth email.",
    }),
});
