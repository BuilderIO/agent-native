/**
 * Mail template onboarding — registers the "Connect Gmail" step with the
 * framework-level onboarding registry. The step is picked up by the onboarding
 * panel in the agent sidebar on every request.
 *
 * The connection uses the framework's managed Google OAuth client. The
 * workspace chooses whether the resulting connection is personal or shared;
 * no user-facing Google Cloud Console setup is required.
 */

import { listOAuthAccountsByOwner } from "@agent-native/core/oauth-tokens";
import { registerOnboardingStep } from "@agent-native/core/onboarding";
import { hasWorkspaceProviderOAuthCredentials } from "@agent-native/core/server";
import { resolveWorkspaceConnectionForApp } from "@agent-native/core/workspace-connections";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.settings.basic",
] as const;

function hasRequiredScope(tokens: unknown): boolean {
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    return false;
  }
  const scope = (tokens as { scope?: unknown }).scope;
  if (typeof scope !== "string" || !scope.trim()) return true;
  const granted = new Set(scope.split(/[\s,]+/).filter(Boolean));
  return GMAIL_SCOPES.some((requiredScope) => granted.has(requiredScope));
}

registerOnboardingStep({
  id: "gmail",
  order: 100,
  required: false,
  title: "Connect Gmail",
  description: "Send, read, and organize real email.",
  isAvailable: () => hasWorkspaceProviderOAuthCredentials("gmail"),
  methods: [
    {
      id: "oauth",
      kind: "link",
      primary: true,
      label: "Connect Gmail for me",
      description:
        "One-click Google sign-in using the workspace's managed OAuth connection. Only you can use this connection.",
      payload: {
        url: "/_agent-native/connections/oauth/gmail/start?scope=user&appId=mail&return=/home",
        external: false,
      },
    },
    {
      id: "oauth-workspace",
      kind: "link",
      label: "Connect Gmail for my workspace",
      description:
        "Workspace admins can connect once and make this Gmail connection available to selected apps or everyone in the workspace.",
      payload: {
        url: "/_agent-native/connections/oauth/gmail/start?scope=organization&appId=mail&return=/home",
        external: false,
      },
    },
    {
      id: "agent-task",
      kind: "agent-task",
      badge: "beta",
      label: "Have the agent set it up for me",
      payload: {
        prompt:
          "Help me connect Gmail through the managed Google OAuth connection. Start the one-click Gmail connection flow, explain the Google permission screen, and confirm whether I want the connection available only to me or to the workspace. Do not ask me to create Google Cloud credentials or paste keys.",
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
          appId: "mail",
          provider: "gmail",
          requireConnected: true,
        })
      ).available;
    } catch {
      // coercion-ok: a failed lookup must leave onboarding incomplete, never completed.
      return false;
    }
  },
});
