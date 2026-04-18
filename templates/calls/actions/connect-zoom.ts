import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getCurrentOwnerEmail, nanoid } from "../server/lib/calls.js";
import { writeAppState } from "@agent-native/core/application-state";

function getPublicUrl(): string {
  const url =
    (typeof process !== "undefined" &&
      (process.env.NITRO_PUBLIC_URL || process.env.PUBLIC_URL)) ||
    "";
  return url.replace(/\/$/, "");
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(bytes).toString("base64")
      : btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256B64Url(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return base64UrlEncode(new Uint8Array(digest));
}

export default defineAction({
  description:
    "Begin the Zoom OAuth flow. Generates a random state + PKCE verifier (stashed in application_state keyed by the user's email) and returns the authorize URL the UI opens in a popup. The OAuth callback is served at /api/oauth/zoom/callback.",
  schema: z.object({
    redirectTo: z
      .string()
      .optional()
      .describe("Optional post-connect redirect path within the app"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const clientId =
      typeof process !== "undefined" ? process.env.ZOOM_CLIENT_ID : undefined;
    if (!clientId) {
      throw new Error(
        "ZOOM_CLIENT_ID is not configured. Add it via the onboarding secrets flow.",
      );
    }

    const ownerEmail = getCurrentOwnerEmail();
    const publicUrl = getPublicUrl();
    if (!publicUrl) {
      throw new Error(
        "PUBLIC_URL / NITRO_PUBLIC_URL must be set to build the Zoom OAuth redirect URI.",
      );
    }
    const redirectUri = `${publicUrl}/api/oauth/zoom/callback`;

    const state = nanoid(32);
    const verifier = nanoid(48);
    const challenge = await sha256B64Url(verifier);

    await writeAppState(`zoom-oauth-${ownerEmail}`, {
      state,
      verifier,
      redirectTo: args.redirectTo ?? "/settings",
      createdAt: new Date().toISOString(),
    });

    const scopes = [
      "recording:read",
      "meeting:read",
      "user:read",
      "cloud_recording:read",
    ].join(" ");

    const authorizeUrl =
      `https://zoom.us/oauth/authorize?response_type=code` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      `&code_challenge=${encodeURIComponent(challenge)}` +
      `&code_challenge_method=S256` +
      `&scope=${encodeURIComponent(scopes)}`;

    return { authorizeUrl, state, redirectUri };
  },
});
