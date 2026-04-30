import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getRequiredSecret, readAppSecret } from "@agent-native/core/secrets";
import { resolveSecret } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";

const namesParam = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  return [];
}, z.array(z.string()).default([]));

async function hasStoredSecret(name: string): Promise<boolean> {
  const userEmail = getRequestUserEmail();
  if (!userEmail) return false;

  // User-scoped secrets: use the framework helper that strictly checks the
  // current request's user. resolveSecret returns null when no per-user row
  // exists; it deliberately does NOT fall back to `process.env[name]` for
  // an authenticated request (multi-tenant impersonation guard).
  const registration = getRequiredSecret(name);
  const scope = registration?.scope ?? "user";
  if (scope === "user") {
    return (await resolveSecret(name)) != null;
  }

  // Workspace-scoped secret: scope by the active org's id.
  const scopeId = getRequestOrgId() ?? `solo:${userEmail}`;
  try {
    const result = await readAppSecret({
      key: name,
      scope: "workspace",
      scopeId,
    });
    return Boolean(result?.value);
  } catch {
    return false;
  }
}

export default defineAction({
  description:
    "Return configured/not-configured status for one or more registered secrets.",
  schema: z.object({
    names: namesParam.describe("Secret keys to check"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const names = args.names;
    const secrets: Record<string, { configured: boolean }> = {};

    for (const name of names) {
      secrets[name] = {
        configured: await hasStoredSecret(name),
      };
    }

    return {
      configured: names.every((name) => secrets[name]?.configured),
      secrets,
    };
  },
});
