/**
 * Suspend, retire, or resume an org service principal.
 *
 * The lifecycle write is what blocks new work (admission, tool dispatch, run
 * start read it). Suspended and retired also CONTAIN the principal: in-flight
 * agent runs it owns are aborted, and retired additionally revokes every
 * active token. The write comes first so nothing new starts while containment
 * runs, and a containment failure is returned (`containmentErrors`,
 * `contained: false`) rather than swallowed: a partial containment must not
 * read as complete.
 *
 * Owner/admin only, and not callable by the agent tool loop.
 */
import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  containServicePrincipal,
  prepareServicePrincipalContainment,
} from "../../agent/contain-principal.js";
import {
  orgAdminAudit,
  recordOrgAdminAuditEvent,
} from "../../audit/org-admin.js";
import {
  SERVICE_PRINCIPAL_LIFECYCLES,
  ServicePrincipalRetiredError,
  setServicePrincipalLifecycle,
  withServicePrincipalLifecycleLock,
} from "../../org/service-principal-policy.js";
import {
  ensureConnectTables,
  revokeServiceTokensByName,
} from "../connect-store.js";
import {
  describeServicePrincipal,
  parseServiceName,
  requireKnownServicePrincipal,
} from "./service-principal-input.js";
import {
  requireServiceTokenCaller,
  ServiceTokenError,
} from "./service-token-access.js";

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export default defineAction({
  description:
    "Suspend, retire, or resume an org service principal. Suspended and retired principals are refused at MCP admission and run start, and their in-flight agent runs are aborted; retired also revokes every active token. The result reports abortedRuns, revokedTokens, and any containmentErrors (contained: false means containment is incomplete — retry). Org owner/admin only.",
  schema: z.object({
    serviceName: z
      .string()
      .min(1)
      .max(64)
      .describe("Service name from list-org-service-tokens"),
    lifecycle: z.enum(SERVICE_PRINCIPAL_LIFECYCLES),
    reason: z.string().trim().max(500).optional(),
  }),
  toolCallable: false,
  audit: orgAdminAudit({
    targetType: "service-principal",
    targetId: (args) => String(args.serviceName ?? ""),
    summary: (args, result) => {
      const r = result as {
        serviceEmail?: string;
        abortedRuns?: number;
        revokedTokens?: number;
        containmentErrors?: string[];
      };
      const errors = r.containmentErrors?.length ?? 0;
      return `Set ${r.serviceEmail ?? args.serviceName} to ${args.lifecycle}: ${r.abortedRuns ?? 0} runs aborted, ${r.revokedTokens ?? 0} tokens revoked${errors ? `, ${errors} containment errors` : ""}`;
    },
  }),
  run: async (args, ctx) => {
    const caller = await requireServiceTokenCaller({
      userEmail: ctx?.userEmail,
      orgId: ctx?.orgId,
      level: "manage",
    });
    const serviceName = parseServiceName(args.serviceName);
    await requireKnownServicePrincipal(caller.orgId, serviceName);

    let policy;
    let abortedRuns = 0;
    let revokedTokens = 0;
    const containmentErrors: string[] = [];
    try {
      if (args.lifecycle !== "active") {
        await prepareServicePrincipalContainment();
      }
      if (args.lifecycle === "retired") {
        await ensureConnectTables();
      }
      policy = await withServicePrincipalLifecycleLock(
        caller.orgId,
        serviceName,
        async (db) => {
          const saved = await setServicePrincipalLifecycle(
            caller.orgId,
            serviceName,
            args.lifecycle,
            { actorEmail: caller.email, reason: args.reason || null },
            db,
          );
          if (args.lifecycle !== "active") {
            try {
              const contained = await containServicePrincipal(
                caller.orgId,
                serviceName,
              );
              abortedRuns = contained.abortedRuns;
              containmentErrors.push(...contained.containmentErrors);
            } catch (error) {
              containmentErrors.push(`abort runs: ${errorMessage(error)}`);
            }
          }
          if (args.lifecycle === "retired") {
            try {
              revokedTokens = await revokeServiceTokensByName(
                caller.orgId,
                serviceName,
              );
            } catch (error) {
              containmentErrors.push(`revoke tokens: ${errorMessage(error)}`);
            }
          }
          return saved;
        },
      );
    } catch (error) {
      if (error instanceof ServicePrincipalRetiredError) {
        throw new ServiceTokenError(error.message, error.statusCode);
      }
      console.error("[service-principal] Lifecycle write failed:", error);
      throw new ServiceTokenError(
        "Could not change the service principal lifecycle. Nothing was changed; try again.",
        503,
      );
    }

    const principal = describeServicePrincipal(
      caller.orgId,
      serviceName,
      policy,
    );
    if (args.lifecycle !== "active") {
      await recordOrgAdminAuditEvent({
        action: "contain-service-principal",
        targetType: "service-principal",
        targetId: serviceName,
        summary: `Contained ${principal.serviceEmail}: ${abortedRuns} runs aborted, ${revokedTokens} tokens revoked${containmentErrors.length ? `, ${containmentErrors.length} errors` : ""}`,
        userEmail: caller.email,
        orgId: caller.orgId,
        status: containmentErrors.length ? "error" : "success",
        caller: ctx?.caller,
      });
    }
    return {
      orgId: caller.orgId,
      serviceEmail: principal.serviceEmail,
      lifecycle: args.lifecycle,
      principal,
      abortedRuns,
      revokedTokens,
      contained: containmentErrors.length === 0,
      containmentErrors,
    };
  },
});
