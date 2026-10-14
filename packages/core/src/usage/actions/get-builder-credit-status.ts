import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  describeChatCredentialState,
  type CredentialState,
} from "../../agent/engine/credential-state.js";
import {
  isResolvedEngineUsableForRequest,
  registerBuiltinEngines,
} from "../../agent/engine/index.js";
import { getAppConfig } from "../../app-config/index.js";
import { readDeployCredentialEnv } from "../../server/credential-provider.js";
import { getBuilderCreditUsage } from "../../server/fusion-app.js";
import { getRequestOrgId } from "../../server/request-context.js";
import { countCredentialState } from "../../tracking/failure-counters.js";
import { clearBuilderCreditLimitNotice } from "../builder-credit-notice.js";
import { canViewWorkspaceUsage } from "../metrics-store.js";

/**
 * `unknown`: the engine the chat runs on could not be resolved, so neither can
 * whether a spent quota stops it. The quota itself is still reported.
 */
export type BuilderCreditNoticeState =
  | CredentialState
  | { kind: "unknown"; quotaSpent: boolean };

export default defineAction({
  description:
    "Check the connected Builder account's active credit quota and whether it stops this user's chats. Organization owners and admins also receive its balance and quota usage.",
  http: { method: "GET" },
  schema: z.object({
    orgId: z.string().nullable().optional(),
    /** The engine the user picked in the chat composer, if they picked one. */
    engine: z.string().optional(),
  }),
  run: async ({ orgId, engine: chosenEngine }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");
    const activeOrgId = getRequestOrgId() ?? null;
    if (orgId !== undefined && orgId !== activeOrgId) {
      throw new Error("The active organization changed. Please retry.");
    }

    const canViewWorkspace = await canViewWorkspaceUsage({
      ownerEmail: ctx.userEmail,
      orgId: activeOrgId,
    });
    const usage = await getBuilderCreditUsage();
    if (!usage) return null;

    // A spent Builder quota is only "used up" for chats that run on Builder,
    // so resolve the engine exactly as the chat request does.
    let state: BuilderCreditNoticeState;
    try {
      registerBuiltinEngines();
      const { resolveChatEngine, resolveOwnerEngineApiKey } =
        await import("../../agent/production-agent.js");
      const credentialIdentity = {
        userEmail: ctx.userEmail,
        orgId: activeOrgId,
      };
      const ownerKey = await resolveOwnerEngineApiKey({
        engineOption: chosenEngine,
        ownerEmail: ctx.userEmail,
        anthropicFallback: readDeployCredentialEnv("ANTHROPIC_API_KEY"),
      });
      const engine = await resolveChatEngine({
        engineOption: chosenEngine,
        ownerKey,
        appId: getAppConfig().app.id ?? getAppConfig().app.template,
        credentialIdentity,
      });
      state = describeChatCredentialState({
        engine: engine.name,
        engineUsable: await isResolvedEngineUsableForRequest(engine, {
          apiKey: ownerKey.apiKey,
          credentialIdentity,
        }),
        builderCredits: usage,
      });
      // The sidebar notice is what tells the user their chats are blocked.
      countCredentialState(state, "credit_notice");
    } catch (error) {
      console.warn(
        "[builder-credit-status] could not resolve the chat engine:",
        error instanceof Error ? error.message : error,
      );
      state = { kind: "unknown", quotaSpent: usage.quota.remaining <= 0 };
    }

    if (usage.quota.remaining > 0) {
      await clearBuilderCreditLimitNotice(ctx.userEmail, activeOrgId);
    }
    return {
      state,
      exhausted: state.kind === "exhausted",
      period: usage.quota.period,
      ...(canViewWorkspace
        ? { balance: usage.balance, quota: usage.quota }
        : {}),
    };
  },
});
