import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description:
    "Explain how to configure deployment-level database connection settings.",
  schema: z.object({
    url: z.string().describe("Forms database URL value (required)"),
    token: z
      .string()
      .optional()
      .describe("Forms database auth token value (optional)"),
  }),
  http: false,
  run: async (args) => {
    const maskedUrl = args.url.replace(/\/\/.*@/, "//***@");
    return [
      `Database connection not written: ${maskedUrl}.`,
      "For Forms, configure FORMS_DATABASE_URL_UNPOOLED when available, otherwise FORMS_DATABASE_URL. DATABASE_URL_UNPOOLED and DATABASE_URL are supported fallbacks. Use the matching *_DATABASE_AUTH_TOKEN for libSQL.",
      "Configure them with your hosting provider and redeploy the app.",
    ].join(" ");
  },
});
