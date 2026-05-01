/**
 * Centralized credential helpers for the @{{APP_NAME}} workspace.
 *
 * Every enterprise has a few API keys that multiple apps need to share:
 * a Slack bot token, a Sentry DSN, an OpenAI key, internal service
 * credentials. Instead of each app reading them separately, we namespace
 * them here so there's a single place to update when a key rotates.
 *
 * Under the hood this is a thin wrapper over @agent-native/core's
 * `resolveCredential()`, which reads per-user / per-org rows in the
 * shared SQL settings table. Apps inside the workspace share the same
 * DATABASE_URL by default, so storing a credential once makes it
 * available everywhere.
 *
 * A request/action context is required so credentials stay scoped to the
 * correct user and organization. This helper can read that context
 * automatically inside agent-native actions; otherwise pass it explicitly.
 */
import { resolveCredential } from "@agent-native/core/credentials";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";

/**
 * Optional context for scoping a credential lookup to a specific user or org.
 */
export interface CompanyCredentialContext {
  userEmail?: string;
  orgId?: string | null;
}

type ResolveCredentialFn = (
  key: string,
  ctx: CompanyCredentialContext,
) => Promise<string | undefined>;

/**
 * Resolve a company-wide credential. Prefer this over `resolveCredential()`
 * directly — it keeps your keys organized under a workspace namespace and
 * makes "where does this secret come from" greppable.
 *
 * Inside an agent-native action:
 *   const slackToken = await resolveCompanyCredential("SLACK_BOT_TOKEN");
 *
 * Outside request context:
 *   const slackToken = await resolveCompanyCredential("SLACK_BOT_TOKEN", {
 *     userEmail: session.email,
 *     orgId: session.orgId ?? null,
 *   });
 */
export async function resolveCompanyCredential(
  key: string,
  ctx?: CompanyCredentialContext,
): Promise<string | undefined> {
  const effectiveCtx: CompanyCredentialContext = ctx?.userEmail
    ? ctx
    : {
        userEmail: getRequestUserEmail() ?? undefined,
        orgId: getRequestOrgId(),
      };
  if (!effectiveCtx.userEmail) return undefined;
  return await (resolveCredential as ResolveCredentialFn)(key, {
    userEmail: effectiveCtx.userEmail,
    orgId: effectiveCtx.orgId ?? null,
  });
}
