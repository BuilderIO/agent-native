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
 * SECURITY: every call requires a `CredentialContext` ({ userEmail, orgId })
 * so reads are scoped to the calling user / org. Inside a framework action
 * (auto-mounted at `/_agent-native/actions/...`) you can read it from
 * `getCredentialContext()`. Inside a custom Nitro `/api/*` route, read the
 * session and wrap your handler in `runWithRequestContext` first.
 */
import {
  resolveCredential,
  type CredentialContext,
} from "@agent-native/core/credentials";
import { getCredentialContext } from "@agent-native/core/server/request-context";

// The published @agent-native/core may still type resolveCredential as
// (key) => Promise<string | undefined>. We intentionally type-erase the
// call so the workspace-core template compiles against both the current
// 1-arg published version and the upcoming 2-arg release.
type ResolveCredentialFn = (
  key: string,
  ctx?: CredentialContext,
) => Promise<string | undefined>;

/**
 * Resolve a company-wide credential. Prefer this over `resolveCredential()`
 * directly — it keeps your keys organized under a workspace namespace and
 * makes "where does this secret come from" greppable.
 *
 * Pass an explicit context when calling from a custom HTTP route. Inside a
 * framework action it can be omitted — the active request context will be
 * used automatically.
 *
 * Example (action / agent tool):
 *   const slackToken = await resolveCompanyCredential("SLACK_BOT_TOKEN");
 *
 * Example (custom Nitro route):
 *   const session = await getSession(event);
 *   if (!session?.email) throw createError({ statusCode: 401 });
 *   const slackToken = await resolveCompanyCredential("SLACK_BOT_TOKEN", {
 *     userEmail: session.email,
 *     orgId: session.orgId ?? null,
 *   });
 */
export async function resolveCompanyCredential(
  key: string,
  ctx?: CredentialContext,
): Promise<string | undefined> {
  const resolved = ctx ?? getCredentialContext();
  if (!resolved) {
    throw new Error(
      `resolveCompanyCredential("${key}") called without a CredentialContext and no active request context was found. Pass { userEmail, orgId } explicitly, or call this from inside a framework action.`,
    );
  }
  return await (resolveCredential as ResolveCredentialFn)(key, resolved);
}
