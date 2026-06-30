/**
 * connect-builder-app — return the Builder connection state / CTA payload for
 * a design so the UI can render the appropriate inline card.
 *
 * This action intentionally does NOT start the OAuth / cli-auth flow; the
 * existing `connect-builder` agent-chat tool owns that flow and renders the
 * interactive card in chat.  What this action does instead:
 *
 * 1. Check whether Builder is currently configured (credentials + project ID)
 *    via the shared `resolveBuilderStatus` helper (no credential values leak).
 * 2. Return a structured payload the UI can use to decide whether to render
 *    an "already connected" summary, a "connect to unlock" CTA, or a
 *    "Builder enabled — ready to migrate" state.
 *
 * The `connectUrl` field is the pre-built URL that opens the Builder cli-auth
 * popup from the current app origin (same shape the agent-chat plugin returns
 * in the `kind: "connect-builder-card"` tool result).  The UI should open this
 * in a popup and poll `/builder/status` for completion, matching the existing
 * connect flow.
 *
 * Gate: any design the caller can view is sufficient — the action is read-only
 * and returns only connection-level metadata, not design content.
 */

import { defineAction } from "@agent-native/core";
import { getBuilderBranchProjectId } from "@agent-native/core/server";
import { getRequestContext } from "@agent-native/core/server/request-context";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs
import { resolveBuilderStatus } from "../shared/builder-app.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The default Builder app host — mirrors the constant in builder-browser.ts. */
const DEFAULT_BUILDER_APP_HOST = "https://builder.io";

/** Resolve the Builder app host from env, matching core builder-browser.ts. */
function resolveBuilderAppHost(): string {
  return (
    process.env.BUILDER_APP_HOST ||
    process.env.BUILDER_PUBLIC_APP_HOST ||
    DEFAULT_BUILDER_APP_HOST
  );
}

/**
 * Build the connect URL for the current deployment's origin.
 * Mirrors the shape returned by `getBuilderBrowserConnectUrl` in core, but
 * without requiring the H3 event — uses the request-context origin instead.
 */
function buildConnectUrl(origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/_agent-native/builder/connect`;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

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
    // Require at least viewer access so unauthenticated callers cannot
    // probe Builder connection state.
    const access = await resolveAccess("design", designId);
    if (!access) {
      throw new Error("Design not found");
    }

    const status = await resolveBuilderStatus();

    // Resolve the connect URL from the current request origin so it points
    // to this exact deployment (same origin as the signed connect token the
    // server mints for cli-auth flows).
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
            "Connect Builder.io to unlock React components, live props, " +
            "data states, branches, and one-click deploys.",
          primaryAction: "Connect Builder.io",
          connectUrl,
        },
        message:
          "Builder is not connected. Open connectUrl to start the OAuth flow.",
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

    // Fully configured — ready for migration.
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
