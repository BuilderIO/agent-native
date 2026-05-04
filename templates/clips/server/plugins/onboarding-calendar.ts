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
      "Optional — you can still record ad-hoc meetings without it. Connecting unlocks: an upcoming-meetings list, one-click record before a meeting starts, and automatic meeting creation from calendar events. Read-only access to Google Calendar; tokens are stored encrypted and scoped per-user.",
    // `required: false` (above) means this step is dismissable — the framework
    // onboarding sidebar lets the user skip non-required steps. The "Open
    // Meetings" deep-link is the secondary path: the connect button lives
    // inline on the Meetings empty-state card, so we surface that route as a
    // method too.
    methods: [
      {
        id: "google",
        kind: "link",
        label: "Connect Google Calendar",
        description:
          "Read-only access to your events. Tokens are stored encrypted, scoped per-user.",
        primary: true,
        payload: {
          url: "/_agent-native/google/auth-url?calendar=1&redirect=1",
        },
      },
      {
        id: "open-meetings",
        kind: "link",
        label: "Open the Meetings tab",
        description:
          "Skip the wizard and connect from the Meetings empty-state card. You can also start an ad-hoc meeting from there.",
        payload: {
          url: "/meetings",
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
    // exists for the current user. The framework's onboarding registry calls
    // this on demand and provides the resolved user via context. We swallow
    // every error so a missing table (pre-migration) or an unauthenticated
    // request never blocks the rest of the checklist.
    isComplete: async (ctx) => {
      const userEmail = ctx?.userEmail;
      if (!userEmail) return false;
      try {
        // Lazy import to avoid pulling DB into module init / breaking SSR
        // before migrations have run.
        const { db, schema } = await import("../db/index.js" as string).catch(
          () => ({ db: null as any, schema: null as any }),
        );
        if (!db || !schema?.calendarAccounts) return false;
        const { eq } = await import("drizzle-orm");
        const rows = await db
          .select({ id: schema.calendarAccounts.id })
          .from(schema.calendarAccounts)
          .where(eq(schema.calendarAccounts.ownerEmail, userEmail))
          .limit(1);
        return rows.length > 0;
      } catch {
        return false;
      }
    },
  });
};
