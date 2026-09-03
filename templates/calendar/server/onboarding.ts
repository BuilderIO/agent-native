import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";
import { registerOnboardingStep } from "@agent-native/core/onboarding";
import { hasWorkspaceProviderOAuthCredentials } from "@agent-native/core/server";
import { resolveWorkspaceConnectionForApp } from "@agent-native/core/workspace-connections";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

function hasRequiredScope(tokens: unknown): boolean {
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    return false;
  }
  const scope = (tokens as { scope?: unknown }).scope;
  if (typeof scope !== "string" || !scope.trim()) return true;
  const granted = new Set(scope.split(/[\s,]+/).filter(Boolean));
  return CALENDAR_SCOPES.some((requiredScope) => granted.has(requiredScope));
}

registerOnboardingStep({
  id: "google-calendar",
  order: 100,
  required: false,
  title: "Connect Google Calendar",
  description: "Manage events and availability with your Google account.",
  isAvailable: () => hasWorkspaceProviderOAuthCredentials("google_calendar"),
  methods: [
    {
      id: "oauth",
      kind: "link",
      primary: true,
      label: "Connect Google Calendar for me",
      description:
        "One-click Google sign-in using the workspace's managed OAuth connection. Only you can use this connection.",
      payload: {
        url: "/_agent-native/connections/oauth/google_calendar/start?scope=user&appId=calendar&return=/settings",
        external: false,
      },
    },
    {
      id: "oauth-workspace",
      kind: "link",
      label: "Connect Google Calendar for my workspace",
      description:
        "Workspace admins can connect once and make this Calendar connection available to selected apps or everyone in the workspace.",
      payload: {
        url: "/_agent-native/connections/oauth/google_calendar/start?scope=organization&appId=calendar&return=/settings",
        external: false,
      },
    },
    {
      id: "agent-task",
      kind: "agent-task",
      badge: "beta",
      label: "Have the agent connect it",
      payload: {
        prompt:
          "Help me connect Google Calendar through the managed Google OAuth connection. Start the one-click Calendar connection flow, explain the Google permission screen, and confirm whether I want the connection available only to me or to the workspace. Do not ask me to create Google Cloud credentials or paste keys.",
      },
    },
  ],
  isComplete: async (context) => {
    if (!context?.userEmail) return false;
    try {
      const accounts = await listOAuthAccountsByOwner(
        "google",
        context.userEmail,
      );
      if (accounts.some((account) => hasRequiredScope(account.tokens))) {
        return true;
      }
      return (
        await resolveWorkspaceConnectionForApp({
          appId: "calendar",
          provider: "google_calendar",
          requireConnected: true,
        })
      ).available;
    } catch {
      // coercion-ok: a failed lookup must leave onboarding incomplete, never completed.
      return false;
    }
  },
});
