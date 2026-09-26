import { defineAction } from "@agent-native/core/action";
import { getBuilderBranchProjectId } from "@agent-native/core/server";
import { getRequestContext } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js";
import { resolveBuilderStatus } from "../shared/builder-app.js";

const DEFAULT_BUILDER_APP_HOST = "https://builder.io";

function resolveBuilderAppHost(): string {
  return (
    process.env.BUILDER_APP_HOST ||
    process.env.BUILDER_PUBLIC_APP_HOST ||
    DEFAULT_BUILDER_APP_HOST
  );
}

function buildConnectUrl(origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/_agent-native/builder/connect`;
}

export default defineAction({
  description:
    "Return the Builder connection state and CTA payload for a design. " +
    "Use this to check whether Builder is configured before offering the " +
    "'Make it real' upgrade flow. Returns { connected, builderEnabled, " +
    "connectUrl, appHost, branchProjectId } so the UI can render the correct " +
    "inline card without making a separate status fetch. " +
    "When connected is false, direct the user to the connectUrl to start the " +
    "Builder OAuth flow. When builderEnabled is true, the Builder cloud agent " +
    "can accept a migration job via migrate-inline-design-to-app.",
  schema: z.object({
    designId: z
      .string()
      .describe("Design project ID to check Builder connection for"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId }) => {
    const access = await resolveAccess("design", designId);
    if (!access) {
      throw new Error("Design not found");
    }

    const status = await resolveBuilderStatus();

    const origin = getRequestContext()?.requestOrigin ?? "";
    const connectUrl = buildConnectUrl(origin);

    const appHost = resolveBuilderAppHost();

    // Surface the env-level branch project id for informational use only.
    // (Credential values are never included.)
    const branchProjectId =
      status.branchProjectId || getBuilderBranchProjectId() || undefined;

    if (!status.connected) {
      return {
        connected: false,
        builderEnabled: false,
        connectUrl,
        appHost,
        branchProjectId,
        cta: {
          kind: "connect-builder" as const,
          label: "Make this a real app",
          description:
            "Connect Builder.io (free tier available) to unlock React components, live props, " +
            "data states, branches, and one-click deploys.",
          primaryAction: "Connect Builder.io",
          connectUrl,
        },
        message:
          "Builder is not connected (free tier available). Open connectUrl to start the OAuth flow.",
      };
    }

    if (!status.builderEnabled) {
      return {
        connected: true,
        builderEnabled: false,
        connectUrl,
        appHost,
        branchProjectId,
        cta: {
          kind: "configure-project" as const,
          label: "Configure Builder project",
          description:
            "Builder credentials are present but no branch project is " +
            "configured. Set DISPATCH_BUILDER_PROJECT_ID, " +
            "BUILDER_BRANCH_PROJECT_ID, or BUILDER_PROJECT_ID to enable " +
            "the cloud agent.",
          primaryAction: "Open Builder settings",
          connectUrl: `${appHost}/account-settings`,
        },
        message:
          "Builder credentials are configured but no branch project ID is set. " +
          "Set DISPATCH_BUILDER_PROJECT_ID to enable cloud agent migration.",
      };
    }

    return {
      connected: true,
      builderEnabled: true,
      connectUrl,
      appHost,
      branchProjectId,
      cta: null,
      message:
        "Builder is connected and cloud agents are available. " +
        "Call migrate-inline-design-to-app to generate a real React app branch.",
    };
  },
});
