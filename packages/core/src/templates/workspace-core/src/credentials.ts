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
 * Once @agent-native/core publishes the upcoming 2-arg signature you can
 * extend this to take a `{ userEmail, orgId }` context and pass it through
 * for per-user / per-org scoping. The current shape works against both
 * versions — the published 1-arg signature ignores the second argument.
 */
import { resolveCredential } from "@agent-native/core/credentials";

/**
 * Optional context for scoping a credential lookup to a specific user or
 * org. Forward-compatible with the upcoming 2-arg @agent-native/core
 * signature; ignored by the current 1-arg published one.
 */
export interface CompanyCredentialContext {
  userEmail?: string;
  orgId?: string | null;
}

type ResolveCredentialFn = (
  key: string,
  ctx?: CompanyCredentialContext,
) => Promise<string | undefined>;

/**
 * Resolve a company-wide credential. Prefer this over `resolveCredential()`
 * directly — it keeps your keys organized under a workspace namespace and
 * makes "where does this secret come from" greppable.
 *
 * Example:
 *   const slackToken = await resolveCompanyCredential("SLACK_BOT_TOKEN");
 *
 * With per-user scoping (after upgrading @agent-native/core):
 *   const slackToken = await resolveCompanyCredential("SLACK_BOT_TOKEN", {
 *     userEmail: session.email,
 *     orgId: session.orgId ?? null,
 *   });
 */
export async function resolveCompanyCredential(
  key: string,
  ctx?: CompanyCredentialContext,
): Promise<string | undefined> {
  return await (resolveCredential as ResolveCredentialFn)(key, ctx);
}
