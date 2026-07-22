import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import { configureNativeCrmConnection } from "../server/crm/native-adapter.js";
import { requireCrmScope } from "./_crm-action-utils.js";

export default defineAction({
  description:
    "Initialize a local-authoritative Native SQL CRM with accounts, people, and opportunities. It requires no provider connection or credential and uses the configured SQLite, Postgres, or D1 database.",
  schema: z.object({
    label: z.string().trim().min(1).max(160).optional(),
  }),
  audit: {
    target: (_args, result) => {
      const connection = result as {
        id: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-connection",
        id: connection.id,
        ownerEmail: connection.ownerEmail,
        orgId: connection.orgId,
        visibility: connection.visibility,
      };
    },
    summary: (_args, result) =>
      `Configured Native SQL CRM ${(result as { id?: string })?.id ?? ""}`,
    recordInputs: false,
  },
  run: async (args, ctx?: ActionRunContext) => {
    const result = await configureNativeCrmConnection({
      label: args.label,
      ownership: requireCrmScope(ctx),
    });
    return {
      ...result,
      provider: "native" as const,
      mode: "native" as const,
    };
  },
});
