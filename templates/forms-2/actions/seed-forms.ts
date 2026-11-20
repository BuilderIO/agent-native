import { defineAction } from "@agent-native/core/action";
import { currentAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { seedForms } from "../scripts/seed-forms.js";
import { formsErrors, personalTenant } from "./_access.js";

export default defineAction({
  description:
    "Development only: replace the current scope's forms with the fixture set (or, with fresh, leave only an empty default workspace).",
  schema: z.object({
    email: z
      .string()
      .optional()
      .describe("Account that owns the fixtures; defaults to the caller"),
    org: z
      .string()
      .optional()
      .describe(
        'Organization id for the fixtures; "none" for a personal scope; defaults to the caller\'s organization',
      ),
    fresh: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .optional()
      .describe("true wipes the scope and creates no forms"),
    parity: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .optional()
      .describe(
        "true seeds one workspace with three forms (two published, one draft) and one submission, for visual parity checks",
      ),
  }),
  outputSchema: z.object({
    scope: z.string(),
    fresh: z.boolean(),
    formIds: z.array(z.string()),
  }),
  errors: formsErrors,
  http: false,
  agentTool: false,
  run: async ({ email, org, fresh, parity }) => {
    const caller = currentAccess();
    const userEmail = email ?? caller.userEmail ?? "dev@local.test";
    const chosen = org === "none" ? null : (org ?? caller.orgId ?? null);
    const orgId = chosen ?? personalTenant(userEmail);
    return seedForms(
      { userEmail, orgId },
      {
        fresh: fresh === true || fresh === "true",
        parity: parity === true || parity === "true",
      },
    );
  },
});
