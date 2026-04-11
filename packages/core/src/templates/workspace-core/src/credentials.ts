/**
 * Centralized credential helpers for the @{{APP_NAME}} workspace.
 *
 * Every enterprise has a few API keys that multiple apps need to share:
 * a Slack bot token, a Sentry DSN, an OpenAI key, internal service
 * credentials. Instead of each app reading them separately, we namespace
 * them here so there's a single place to update when a key rotates.
 *
 * Under the hood this is a thin wrapper over @agent-native/core's
 * `resolveCredential()`, which reads `process.env.<KEY>` first and
 * falls back to `credential:<KEY>` in the shared settings table.
 * Apps inside the workspace share the same DATABASE_URL by default,
 * so storing a credential once makes it available everywhere.
 */
import { resolveCredential } from "@agent-native/core/credentials";

/**
 * Resolve a company-wide credential. Prefer this over `resolveCredential()`
 * directly — it keeps your keys organized under a workspace namespace and
 * makes "where does this secret come from" greppable.
 *
 * Example:
 *   const slackToken = await resolveCompanyCredential("SLACK_BOT_TOKEN");
 */
export async function resolveCompanyCredential(
  key: string,
): Promise<string | undefined> {
  return await resolveCredential(key);
}
