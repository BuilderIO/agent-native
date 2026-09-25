import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import type { BuilderDefaultModel } from "../../secrets/usage.js";
import type { BuilderConnectionsStatus } from "../../server/core-routes-plugin.js";

export interface BuilderConnectionState extends BuilderConnectionsStatus {
  /**
   * Whether the default model runs on Builder.io and what it does once
   * Builder.io is disconnected. `unknown` means it couldn't be read.
   */
  defaultModel: BuilderDefaultModel | { status: "unknown"; error: string };
}

export interface BuilderDisconnectResult {
  disconnected: "org" | "personal";
  /** Unset when there was no OAuth grant to revoke, only stored keys. */
  remoteRevoked?: boolean;
  warning?: string;
}

async function readDefaultModel(
  appId: string | undefined,
): Promise<BuilderConnectionState["defaultModel"]> {
  try {
    const { describeBuilderDefaultModel } =
      await import("../../secrets/usage.js");
    return await describeBuilderDefaultModel(appId);
  } catch (error) {
    return {
      status: "unknown",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default defineAction({
  description:
    'Read or disconnect the Builder.io connections. Builder.io has an organization connection (shared with every member; owners and admins connect and disconnect it) and a member\'s personal one (used ahead of the organization\'s, only by that member). Omit `disconnect` to read: `grants.org` and `grants.personal` are the stored connections (`{}` none, `null` unreadable; a personal grant with `restricted: true` is unused because "Restrict personal API keys" is on), `canConnect` says which the caller may connect, and `defaultModel` says whether the default model runs on Builder.io and whether disconnecting switches it to another provider (`next`) or stops chats. Pass `disconnect: "org"` (owners and admins; confirm with the user first, since it affects everyone) or `disconnect: "personal"` (the caller\'s own; they fall back to the organization\'s). Connecting needs the browser sign-in on the Builder.io settings page.',
  schema: z.object({
    disconnect: z
      .enum(["org", "personal"])
      .optional()
      .describe(
        'Which connection to disconnect: "org" (owners and admins) or "personal" (the caller\'s own). Omit to read the connections.',
      ),
  }),
  http: { method: "POST" },
  // A read must not announce a change, or every query keyed on actions
  // refetches after each read.
  planMode: {
    effect: (args) => (args.disconnect === undefined ? "read" : "write"),
    omittedProperties: ["disconnect"],
  },
  // disconnectBuilderConnectionAtScope records the disconnect at its scope.
  audit: { enabled: false },
  run: async (
    args,
    ctx,
  ): Promise<BuilderConnectionState | BuilderDisconnectResult> => {
    const email = ctx?.userEmail?.trim().toLowerCase();
    if (!email) {
      fail("Sign in to manage the Builder.io connection.", {
        statusCode: 401,
      });
    }
    const orgId = ctx?.orgId?.trim() || null;
    const { readOrgMemberRole } =
      await import("../../server/personal-provider-key-policy.js");
    const role = orgId ? await readOrgMemberRole(orgId, email) : null;
    const {
      disconnectBuilderConnectionAtScope,
      resolveBuilderConnectionsStatus,
    } = await import("../../server/core-routes-plugin.js");

    if (args.disconnect) {
      const result = await disconnectBuilderConnectionAtScope({
        email,
        orgId,
        role,
        scope: args.disconnect,
      });
      if (result.status !== 200) {
        fail(result.body.error, {
          statusCode: result.status,
          errorCode:
            result.status === 403
              ? "builder_org_connection_admin_required"
              : "builder_connection_not_found",
        });
      }
      return {
        disconnected: result.body.scope,
        ...(result.body.remoteRevoked !== undefined
          ? { remoteRevoked: result.body.remoteRevoked }
          : {}),
        ...(result.body.warning ? { warning: result.body.warning } : {}),
      };
    }

    const [connections, defaultModel] = await Promise.all([
      resolveBuilderConnectionsStatus({ ownerEmail: email, orgId, role }),
      readDefaultModel(ctx?.appId),
    ]);
    return { ...connections, defaultModel };
  },
});
