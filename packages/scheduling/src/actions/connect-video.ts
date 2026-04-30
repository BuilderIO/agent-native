/**
 * Start the OAuth flow for a video conferencing provider (e.g. Zoom).
 *
 * Returns an `authUrl` the UI should redirect to, plus the `state` value so
 * the caller's OAuth callback route can validate it. Consumers handle the
 * callback at `/_agent-native/oauth/<kind>/callback` (see
 * `handleVideoOAuthCallback` in the server entry point).
 *
 * The `state` value is HMAC-signed against the request user's email and a
 * server secret so the callback can verify the OAuth round-trip belongs to
 * the same authenticated user that started it. See `verifyVideoOAuthState`
 * in `../server/video-oauth-state.ts`.
 *
 * Zero-OAuth providers (the built-in video provider, or Google Meet via the
 * Google Calendar credential) do not expose `startOAuth` and should be
 * installed via `install-conferencing-app` instead.
 */
import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";
import { getVideoProvider } from "../server/providers/registry.js";
import { signVideoOAuthState } from "../server/video-oauth-state.js";

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export default defineAction({
  description: "Start the OAuth flow for a video conferencing provider",
  schema: z.object({
    kind: z.string(),
    redirectUri: z.string(),
  }),
  run: async (args) => {
    const provider = getVideoProvider(args.kind);
    if (!provider) {
      throw badRequest(`No video provider registered for ${args.kind}`);
    }
    if (!provider.startOAuth) {
      throw badRequest(
        `Video provider ${args.kind} does not support OAuth — install it with 'install-conferencing-app' instead`,
      );
    }
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      throw Object.assign(new Error("Authentication required"), {
        statusCode: 401,
      });
    }
    const state = signVideoOAuthState({ kind: args.kind, userEmail });
    const { authUrl } = await provider.startOAuth({
      redirectUri: args.redirectUri,
      state,
    });
    return { authUrl, state };
  },
});
