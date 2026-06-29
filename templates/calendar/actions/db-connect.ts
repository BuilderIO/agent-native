import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description: "Configure a remote database connection",
  schema: z.object({
    url: z.string().optional().describe("DATABASE_URL (required)"),
    token: z
      .string()
      .optional()
      .describe(
        "DATABASE_AUTH_TOKEN (optional, required for most remote providers)",
      ),
  }),
  http: false,
  run: async (args) => {
    if (!args.url) {
      throw new Error("url is required (e.g., libsql://your-db.turso.io)");
    }

    const url = args.url;
    const token = args.token || "";

    const maskedUrl = url.replace(/\/\/.*@/, "//***@");

    try {
      const { createClient } = await import("@libsql/client/web");
      const client = createClient({ url, authToken: token || undefined });
      await client.execute("SELECT 1");
    } catch (err: any) {
      throw new Error(`Connection failed to ${maskedUrl}: ${err.message}`);
    }

    return [
      `Database connection verified: ${maskedUrl}.`,
      "DATABASE_URL and DATABASE_AUTH_TOKEN are deployment-level settings.",
      "Configure them with your hosting provider and redeploy the app.",
    ].join(" ");
  },
});
