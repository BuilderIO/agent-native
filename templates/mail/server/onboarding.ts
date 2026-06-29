/**
 * Mail template onboarding — registers the "Connect Gmail" step with the
 * framework-level onboarding registry. The step is picked up by the onboarding
 * panel in the agent sidebar on every request.
 *
 * Two completion methods are offered:
 *   1. Manual wizard — links back to the app root, where the existing
 *      `GoogleConnectBanner` auto-detects missing credentials and guides the
 *      user through the Google Cloud Console setup.
 *   2. Agent task — hands the task to the agent, which drives the user's
 *      browser (or falls back to verbal step-by-step instructions) and saves
 *      the resulting credentials as workspace-scoped DB keys.
 */

import { registerOnboardingStep } from "@agent-native/core/onboarding";
import { readDeployCredentialEnv } from "@agent-native/core/server";

registerOnboardingStep({
  id: "gmail",
  order: 100,
  required: false,
  title: "Connect Gmail",
  description: "Send, read, and organize real email.",
  methods: [
    {
      id: "manual-wizard",
      kind: "link",
      primary: true,
      label: "Connect Google OAuth (guided)",
      description: "3-minute guided setup in Google Cloud Console.",
      payload: { url: "/" },
    },
    {
      id: "agent-task",
      kind: "agent-task",
      badge: "beta",
      label: "Have the agent set it up for me",
      payload: {
        prompt:
          "Help me connect Gmail. Walk me through creating Google OAuth credentials by driving my browser (use any mcp__*browser* tools available, or fall back to giving me step-by-step instructions with exact URLs and values). When client_id and client_secret are ready, help me configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as deployment or local environment variables for Mail, then restart or redeploy before clicking Sign in with Google.",
      },
    },
  ],
  isComplete: async () =>
    Boolean(
      readDeployCredentialEnv("GOOGLE_CLIENT_ID") &&
      readDeployCredentialEnv("GOOGLE_CLIENT_SECRET"),
    ),
});
