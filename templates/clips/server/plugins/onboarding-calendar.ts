/**
 * Registers the "Connect a calendar" onboarding step for the Meetings tab.
 *
 * Lives in its own plugin file so the main `onboarding.ts` plugin (which
 * mounts the framework's onboarding routes) is not touched by parallel
 * agents. Both plugins share the same in-memory `registerOnboardingStep`
 * registry so order between them does not matter — the framework's plugin
 * runs first because of file-name sort.
 */

import { registerOnboardingStep } from "@agent-native/core/onboarding";

export default async (): Promise<void> => {
  registerOnboardingStep({
    id: "calendar",
    order: 30,
    required: false,
    title: "Connect a calendar",
    description:
      "Sync upcoming meetings, get a notification a few minutes before, and one-click record + transcribe.",
    methods: [
      {
        id: "google",
        kind: "link",
        label: "Connect Google Calendar",
        description:
          "Read-only access to events. Tokens are stored encrypted, scoped per-user.",
        primary: true,
        payload: {
          url: "/api/auth/google-calendar?redirect=1",
        },
      },
      {
        id: "api-key",
        kind: "form",
        label: "Use a Google API key",
        description:
          "Paste a service-account or OAuth client API key. Less common; OAuth is preferred.",
        payload: {
          writeScope: "workspace",
          fields: [
            {
              key: "GOOGLE_CALENDAR_API_KEY",
              label: "Google API key",
              secret: true,
            },
          ],
        },
      },
    ],
    // The completion check is best-effort — the action layer is the source of
    // truth, so we only mark complete when at least one calendar_account row
    // exists for the user. The framework's onboarding registry calls this on
    // demand.
    isComplete: async () => {
      try {
        // Lazy import to avoid pulling DB into module init.
        const { db, schema } = await import("../db/index.js" as string).catch(
          () => ({ db: null as any, schema: null as any }),
        );
        if (!db || !schema?.calendarAccounts) return false;
        const rows = await db
          .select({ id: schema.calendarAccounts.id })
          .from(schema.calendarAccounts)
          .limit(1);
        return rows.length > 0;
      } catch {
        return false;
      }
    },
  });
};
