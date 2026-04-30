import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getCalendarProvider } from "../server/providers/registry.js";

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export default defineAction({
  description: "Start the OAuth flow for a calendar provider",
  schema: z.object({
    kind: z.string(),
    redirectUri: z.string(),
  }),
  run: async (args) => {
    const provider = getCalendarProvider(args.kind);
    if (!provider)
      throw badRequest(`No calendar provider registered for ${args.kind}`);
    const state = nanoid(16);
    const { authUrl } = await provider.startOAuth({
      redirectUri: args.redirectUri,
      state,
    });
    return { authUrl, state };
  },
});
