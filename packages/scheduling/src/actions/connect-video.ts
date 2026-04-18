/**
 * Start the OAuth flow for a video conferencing provider (e.g. Zoom).
 *
 * Returns an `authUrl` the UI should redirect to, plus the `state` value so
 * the caller's OAuth callback route can validate it. Consumers handle the
 * callback at `/_agent-native/oauth/<kind>/callback` (see
 * `handleVideoOAuthCallback` in the server entry point).
 *
 * Zero-OAuth providers (Cal Video, built-in Google Meet via the Google
 * Calendar credential) do not expose `startOAuth` and should be installed
 * via `install-conferencing-app` instead.
 */
import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getVideoProvider } from "../server/providers/registry.js";

export default defineAction({
  description: "Start the OAuth flow for a video conferencing provider",
  schema: z.object({
    kind: z.string(),
    redirectUri: z.string(),
  }),
  run: async (args) => {
    const provider = getVideoProvider(args.kind);
    if (!provider) {
      throw new Error(`No video provider registered for ${args.kind}`);
    }
    if (!provider.startOAuth) {
      throw new Error(
        `Video provider ${args.kind} does not support OAuth — install it with 'install-conferencing-app' instead`,
      );
    }
    const state = nanoid(16);
    const { authUrl } = await provider.startOAuth({
      redirectUri: args.redirectUri,
      state,
    });
    return { authUrl, state };
  },
});
