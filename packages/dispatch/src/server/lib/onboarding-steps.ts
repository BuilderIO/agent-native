/**
 * Dispatch-specific onboarding steps.
 *
 * Slack/Telegram/etc. are auto-registered at order 60 by the framework when
 * their env keys are declared `required: true` in `env-config.ts`. Without
 * any earlier dispatch-specific step, a brand-new workspace lands on
 * "Connect Slack" as the first visible to-do — which is intimidating before
 * the user has even created a real app. This step nudges them at adding
 * their first workspace app first.
 */

import { listIntegrationInstallations } from "@agent-native/core/integrations";
import { registerOnboardingStep } from "@agent-native/core/onboarding";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";

import { listWorkspaceApps } from "./app-creation-store.js";

let registered = false;

export function registerDispatchOnboardingSteps(): void {
  if (registered) return;
  registered = true;

  registerOnboardingStep({
    id: "dispatch:create-first-app",
    title: "Create your first app",
    description:
      "Add a workspace app like Mail, Calendar, or Slides — or describe a custom app from the Apps page.",
    order: 5,
    required: false,
    methods: [
      {
        id: "open-apps",
        kind: "link",
        primary: true,
        label: "Browse apps",
        payload: { url: "/dispatch/apps", external: false },
      },
    ],
    isComplete: async () => {
      try {
        const apps = await listWorkspaceApps({
          includeAgentCards: false,
          includeArchived: true,
        });
        return apps.some((app) => !app.isDispatch);
      } catch {
        return false;
      }
    },
  });

  registerOnboardingStep({
    id: "dispatch:connect-slack-workspace",
    title: "Connect a Slack workspace",
    description:
      "Install Agent Native with OAuth, then configure channel identities and access policies.",
    order: 60,
    required: false,
    methods: [
      {
        id: "open-messaging",
        kind: "link",
        primary: true,
        label: "Open Messaging",
        payload: { url: "/messaging", external: false },
      },
    ],
    isComplete: async () => {
      const userEmail = getRequestUserEmail();
      if (!userEmail) return false;
      const rows = await listIntegrationInstallations(
        { userEmail, orgId: getRequestOrgId() ?? null },
        "slack",
      ).catch(() => []);
      return rows.some((row) => row.status === "connected");
    },
  });
}
