import { getDbExec } from "@agent-native/core/db";
import {
  createCustomProviderRegistrationAction,
  CustomProviderRegistrationSchema,
} from "@agent-native/core/provider-api/actions/custom-provider-registration";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

async function resolveCallerOrgRole(orgId: string, email: string) {
  try {
    const { rows } = await getDbExec().execute({
      sql: `SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1`,
      args: [orgId, email.toLowerCase()],
    });
    const role = (rows[0] as { role?: unknown } | undefined)?.role;
    return typeof role === "string" && role ? role : null;
  } catch {
    return null;
  }
}

const schema = CustomProviderRegistrationSchema.superRefine((value, ctx) => {
  if (value.operation === "upsert" && value.baseUrl) {
    try {
      const url = new URL(value.baseUrl);
      if (url.protocol !== "https:") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["baseUrl"],
          message: "baseUrl must use public HTTPS.",
        });
      }
    } catch {
      // The shared schema reports malformed URLs.
    }
  }
});

const action = createCustomProviderRegistrationAction({
  schema,
  getContext: getCredentialContext,
  resolveOrgRole: resolveCallerOrgRole,
  description:
    "Register or update an Analytics custom API provider. Stores credential key names only, never secret values. Requires a public HTTPS base URL and owner/admin organization access.",
});

// The shared factory owns registration, validation, and mutation authorization;
// this wrapper only adds Analytics' transport contract and base URL policy.
// Static action registry marker: createCustomProviderRegistrationAction returns defineAction.
export default { ...action, http: { method: "POST" as const } };
