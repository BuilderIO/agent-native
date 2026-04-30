import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDb } from "../server/db/index.js";

const namesParam = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return [value];
  return [];
}, z.array(z.string()).default([]));

async function hasStoredSecret(name: string): Promise<boolean> {
  try {
    const db = getDb() as any;
    const result = await db.execute({
      sql: "SELECT 1 FROM app_secrets WHERE key = ? LIMIT 1",
      args: [name],
    });
    return (result.rows?.length ?? 0) > 0;
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
        configured: Boolean(process.env[name]) || (await hasStoredSecret(name)),
      };
    }

    return {
      configured: names.every((name) => secrets[name]?.configured),
      secrets,
    };
  },
});
