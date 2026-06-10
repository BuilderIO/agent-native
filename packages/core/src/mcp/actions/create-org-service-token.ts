/**
 * Mint an org-scoped SERVICE token for CI and other non-human callers (e.g.
 * the `PLAN_RECAP_TOKEN` GitHub secret used by PR Visual Recap). Unlike a
 * personal connect token, the credential belongs to the ORG: it keeps working
 * when the human who minted it leaves or revokes their own tokens, and rows
 * created with it are org-scoped so every org member can see them.
 *
 * SECURITY:
 *   - Gated to org owners/admins (see service-token-access.ts).
 *   - The token value appears ONLY in this action's response — it is never
 *     stored (only its `jti`) and never logged.
 *   - Not callable by the sandboxed agent tool loop (`toolCallable: false`):
 *     minting a long-lived credential must be an explicit human/HTTP/CLI act,
 *     never a prompt-injection target.
 *   - Revocable via `revoke-org-service-token` — same `revoked_at` gate the
 *     personal-token revocation path uses.
 */
import { z } from "zod";
import { defineAction } from "../../action.js";
import { getRequestContext } from "../../server/request-context.js";
import { getAppProductionUrl } from "../../server/app-url.js";
import { mintOrgServiceToken } from "../connect-route.js";
import {
  requireServiceTokenCaller,
  ServiceTokenError,
} from "./service-token-access.js";

export default defineAction({
  description:
    "Create a named, org-scoped service token (for CI like PR Visual Recap's PLAN_RECAP_TOKEN). The token acts as a service principal owned by the organization, not a person. Org owner/admin only. The token value is returned ONCE and never stored — copy it immediately.",
  schema: z.object({
    name: z
      .string()
      .min(1)
      .max(64)
      .describe("Short service name, e.g. 'ci' or 'pr-recap'"),
    ttlDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe("Token lifetime in days (1-365, default 365)"),
  }),
  toolCallable: false,
  run: async (args, ctx) => {
    const caller = await requireServiceTokenCaller({
      userEmail: ctx?.userEmail,
      orgId: ctx?.orgId,
      level: "manage",
    });

    // App origin for OAuth-signed tokens (resource/issuer binding). The MCP
    // path provides requestOrigin via runWithRequestContext; the HTTP action
    // route falls back to the configured production URL. Deployments with
    // A2A_SECRET don't depend on it (the A2A signer ignores appUrl).
    const appUrl = (
      getRequestContext()?.requestOrigin || getAppProductionUrl()
    ).replace(/\/+$/, "");
    if (!appUrl && !process.env.A2A_SECRET?.trim()) {
      throw new ServiceTokenError(
        "Could not determine the app URL needed to mint a token. Set APP_URL on the deployment.",
        500,
      );
    }

    const minted = await mintOrgServiceToken({
      serviceName: args.name,
      orgId: caller.orgId,
      createdBy: caller.email,
      ttlDays: args.ttlDays,
      appUrl,
    });

    return {
      // The ONLY place the secret ever appears. Never stored, never logged.
      token: minted.token,
      id: minted.id,
      serviceName: minted.serviceName,
      serviceEmail: minted.serviceEmail,
      orgId: caller.orgId,
      ttlDays: minted.ttlDays,
      note: "Store this token now (e.g. as the PLAN_RECAP_TOKEN GitHub Actions secret). It will not be shown again. Revoke it any time with revoke-org-service-token.",
    };
  },
});
