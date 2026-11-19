import type {
  SlackAuthTestResult,
  SlackMessage,
  Workspace,
} from "../connectors/slack.js";
import { isUnreadableSecret } from "../lib/unreadable-secret.js";
import { WorkflowActionError } from "../lib/workflow-action-errors.js";

export const SLACK_IDENTITY_UNRESOLVED_CODE = "slack_identity_unresolved";

const MAX_CAUSE_CHARS = 300;

/**
 * The app could not learn which Slack user and bot it is. "Unknown who we are"
 * is not "we are nobody": taking every post would let a workflow read its own
 * notices as new reports, so the read stops and takes nothing.
 */
export class SlackIdentityUnresolvedError extends WorkflowActionError {
  cause?: unknown;

  constructor(cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super({
      message: `The app's own Slack identity was unreadable (${reason.slice(0, MAX_CAUSE_CHARS)}), so the channel was left unread: its own posts cannot be told apart from reports. Nothing was taken.`,
      errorCode: SLACK_IDENTITY_UNRESOLVED_CODE,
      statusCode: 424,
      retryable: true,
    });
    this.name = "SlackIdentityUnresolvedError";
    this.cause = cause;
  }
}

/** What Slack's `auth.test` says this app is: the bot user and, for a bot token, the bot. */
export interface OwnSlackIdentity {
  userId: string;
  botId?: string;
}

/**
 * The identity the Slack reader already verifies before every read, read once
 * more from its cache: there is no second lookup. A key that is saved but
 * cannot be decrypted keeps its own code; any other failure is this one's.
 */
export async function resolveOwnSlackIdentity(
  slack: {
    getAgentNativeIdentity(workspace: Workspace): Promise<SlackAuthTestResult>;
  },
  workspace: Workspace,
): Promise<OwnSlackIdentity> {
  let auth: SlackAuthTestResult;
  try {
    auth = await slack.getAgentNativeIdentity(workspace);
  } catch (error) {
    if (isUnreadableSecret(error)) throw error;
    throw new SlackIdentityUnresolvedError(error);
  }
  if (!auth.userId) {
    throw new SlackIdentityUnresolvedError("auth.test returned no user id");
  }
  return {
    userId: auth.userId,
    ...(auth.botId ? { botId: auth.botId } : {}),
  };
}

/** A message and the messages inside it: an edit or a delete holds the one it is about, and the author is there. */
function carriersOf(message: SlackMessage): SlackMessage[] {
  return [message, message.message, message.previous_message].filter(
    (part): part is SlackMessage => part !== undefined,
  );
}

function namesOwnIdentity(part: SlackMessage, own: OwnSlackIdentity): boolean {
  if (part.user === own.userId) return true;
  if (part.bot_profile?.user_id === own.userId) return true;
  return (
    own.botId !== undefined &&
    (part.bot_id === own.botId || part.bot_profile?.id === own.botId)
  );
}

/**
 * Which messages this app posted, among the page it read. A post counts as the
 * app's when it names the app's user, its bot or its Slack app, at the top
 * level or inside an edit or delete event. The app's own Slack app id is not
 * something `auth.test` gives, so it is learned from the posts that name the
 * user or bot: a post that carries only the app id is then still recognised.
 * Any one of the three is enough, so a field Slack left off a message cannot
 * let the app's post through.
 */
export function ownPostMatcher(
  messages: readonly SlackMessage[],
  own: OwnSlackIdentity,
): (message: SlackMessage) => boolean {
  const appIds = new Set<string>();
  for (const message of messages) {
    for (const part of carriersOf(message)) {
      if (!namesOwnIdentity(part, own)) continue;
      for (const appId of [part.app_id, part.bot_profile?.app_id]) {
        if (appId) appIds.add(appId);
      }
    }
  }
  const namesOwnApp = (part: SlackMessage): boolean =>
    [part.app_id, part.bot_profile?.app_id].some(
      (appId) => appId !== undefined && appIds.has(appId),
    );
  return (message) =>
    carriersOf(message).some(
      (part) => namesOwnIdentity(part, own) || namesOwnApp(part),
    );
}
