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
 *      browser (or falls back to verbal step-by-step instructions) and writes
 *      the resulting credentials into the workspace `.env` via
 *      `POST /_agent-native/env-vars`.
 */

import { registerOnboardingStep } from "@agent-native/core/onboarding";

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
      label: "Set up Google OAuth (guided)",
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
          'Help me connect Gmail. Walk me through creating Google OAuth credentials by driving my browser (use any mcp__*browser* tools available, or fall back to giving me step-by-step instructions with exact URLs and values). When client_id and client_secret are ready, save them to my workspace .env via POST /_agent-native/env-vars with scope "workspace". Then tell me to click "Sign in with Google" in the mail onboarding banner to finish the OAuth sign-in.',
      },
    },
  ],
  isComplete: () =>
    !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
});
