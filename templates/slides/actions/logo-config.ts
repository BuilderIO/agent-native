import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description: "Get logo search configuration (Brandfetch client ID status).",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    return {
      brandfetchId: process.env.BRANDFETCH_CLIENT_ID || null,
      hasLogoDevSecret: !!process.env.LOGO_DEV_SECRET_KEY?.startsWith("sk_"),
    };
  },
});
