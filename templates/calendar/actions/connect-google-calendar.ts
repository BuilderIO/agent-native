import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

const CONNECT_PATH = "/_agent-native/google/auth-url";
const ADD_ACCOUNT_PATH = "/_agent-native/google/add-account/auth-url";

function normalizeReturnPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, "https://calendar.agent-native.local");
    if (url.origin !== "https://calendar.agent-native.local") {
      return undefined;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

export default defineAction({
  description:
    "Create a user-clickable Google Calendar OAuth link. Use this when the user asks to connect or reconnect Google Calendar. Do not fetch the returned URL as an API; the signed-in user must open it in their browser.",
  schema: z.object({
    addAccount: z
      .boolean()
      .optional()
      .describe(
        "Use true only when adding another Google Calendar account to an already connected Calendar workspace.",
      ),
    returnPath: z
      .string()
      .optional()
      .describe(
        "Optional same-origin Calendar path to return to after the Google OAuth flow.",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  run: async (args) => {
    const owner = getRequestUserEmail();
    if (!owner) {
      throw new Error("Sign in to Calendar before connecting Google Calendar.");
    }

    const path = args.addAccount ? ADD_ACCOUNT_PATH : CONNECT_PATH;
    const params = new URLSearchParams({ redirect: "1" });
    if (!args.addAccount) params.set("calendar", "1");

    const returnPath = normalizeReturnPath(args.returnPath);
    if (returnPath) params.set("return", returnPath);

    const url = `${path}?${params.toString()}`;
    const label = args.addAccount
      ? "Add Google Calendar account"
      : "Connect Google Calendar";
    return {
      provider: "google_calendar",
      url,
      label,
      markdown: `[${label}](${url})`,
      message:
        "Open this link in the signed-in Calendar browser session to connect Google Calendar. Do not fetch it from the agent backend.",
      requiresUserGesture: true,
    };
  },
  link: ({ result }) => {
    const url =
      result && typeof result === "object"
        ? (result as { url?: unknown }).url
        : null;
    if (typeof url !== "string" || !url) return null;
    return {
      url,
      label: "Connect Google Calendar",
      view: "settings",
    };
  },
});
