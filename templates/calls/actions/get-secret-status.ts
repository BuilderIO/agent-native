import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getRequiredSecret, readAppSecret } from "@agent-native/core/secrets";
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
  const registration = getRequiredSecret(name);
  const scope = registration?.scope ?? "user";
  const userEmail = getRequestUserEmail();
  if (!userEmail) return false;
  const scopeId =
    scope === "workspace"
      ? (getRequestOrgId() ?? `solo:${userEmail}`)
      : userEmail;
  try {
    const result = await readAppSecret({
      key: name,
      scope,
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
