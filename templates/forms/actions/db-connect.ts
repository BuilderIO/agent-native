import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description:
    "Explain how to configure deployment-level database connection settings.",
  schema: z.object({
    url: z.string().describe("DATABASE_URL value (required)"),
    token: z.string().optional().describe("DATABASE_AUTH_TOKEN value"),
  }),
  http: false,
  run: async (args) => {
    const maskedUrl = args.url.replace(/\/\/.*@/, "//***@");
    return [
      `Database connection not written: ${maskedUrl}.`,
      "DATABASE_URL and DATABASE_AUTH_TOKEN are deployment-level database settings.",
      "Configure them with your hosting provider and redeploy the app.",
    ].join(" ");
  },
});
