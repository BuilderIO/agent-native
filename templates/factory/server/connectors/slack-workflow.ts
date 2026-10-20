import type { ActionRunContext } from "@agent-native/core/action";

import { getDb } from "../db/index.js";
import { readCallingFactoryAutomation } from "../lib/factory-automation-caller.js";
import { readTriageConfigRow } from "../lib/factory-scope.js";
import { isSlackChannelId } from "../lib/slack-channel-id.js";
import { failWorkflowAction } from "../lib/workflow-action-errors.js";
import {
  WORKFLOW_ACTION_OUTPUT_BUDGET_CHARS,
  clipText,
  takeWithinBudget,
} from "../lib/workflow-action-support.js";
import type { createSlackWorkflowClient } from "../triage/slack-client.js";
import { SlackWriteError, type SlackMessage, type Workspace } from "./slack.js";

type SlackReader = ReturnType<typeof createSlackWorkflowClient>;

export const SLACK_MESSAGE_TEXT_LIMIT = 4_000;
// Slack cuts a message over 40,000 characters without saying so, so refuse one
// that could be cut.
export const SLACK_POST_TEXT_MAX = 39_000;
const REACTION_USERS_LIMIT = 25;
const SLACK_USER_ID = /^[UW][A-Z0-9]{2,}$/;
const SLACK_TS = /^\d{1,12}\.\d{1,9}$/;
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const SLACK_PING_OPEN = /<(?=[!@])/g;

export function isSlackTimestamp(value: string): boolean {
  return SLACK_TS.test(value);
}

/** Orders two Slack timestamps exactly: a float cannot hold ten digits and six decimals. */
export function compareSlackTs(left: string, right: string): number {
  const [leftSeconds = "0", leftMicros = ""] = left.split(".");
  const [rightSeconds = "0", rightMicros = ""] = right.split(".");
  const seconds = BigInt(leftSeconds) - BigInt(rightSeconds);
  if (seconds !== 0n) return seconds < 0n ? -1 : 1;
  const a = leftMicros.padEnd(9, "0");
  const b = rightMicros.padEnd(9, "0");
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The Slack workspace a workflow reads and writes: the calling job's choice
 * first, then the factory's, as the Slack poller resolves it.
 */
export async function resolveFactorySlackWorkspace(
  context: ActionRunContext | undefined,
  identity: { userEmail: string; orgId: string },
  factoryId: string,
): Promise<Workspace> {
  const job = await readCallingFactoryAutomation(context, identity);
  const config = await readTriageConfigRow(getDb(), identity.orgId, factoryId);
  return job?.config.slackWorkspace === "secondary" ||
    config?.slackWorkspace === "secondary"
    ? "secondary"
    : "primary";
}

/** The `ok: false` code Slack sent, or null. Never the raw response body. */
function slackApiCode(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  return /^Slack API error: ([A-Za-z0-9_]+)$/.exec(message)?.[1] ?? null;
}

function slackHttpStatus(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const status = /^Slack API error (\d{3}):/.exec(message)?.[1];
  return status ? Number(status) : null;
}

const NOT_FOUND_CODES = new Set([
  "channel_not_found",
  "thread_not_found",
  "not_in_channel",
  "is_archived",
  "message_not_found",
]);
const ACCESS_CODES = new Set([
  "missing_scope",
  "not_allowed_token_type",
  "invalid_auth",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "no_permission",
  "restricted_action",
  "access_denied",
  "channel_not_allowed",
  "team_access_not_granted",
]);

type SlackOperation = "read" | "post" | "lookup";

function failIfSlackNotReady(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /No Slack bot token configured|credential resolver is required/i.test(
      message,
    )
  ) {
    failWorkflowAction({
      message:
        "Slack is not connected for this workspace. Connect Slack in Dispatch or add a bot token to the vault.",
      errorCode: "slack_not_connected",
      statusCode: 412,
    });
  }
  if (/authenticated as @.*not @agent-native/i.test(message)) {
    failWorkflowAction({
      message:
        "The connected Slack credential is not the @agent-native bot, so Factory will not use it.",
      errorCode: "slack_identity_mismatch",
      statusCode: 412,
    });
  }
}

/**
 * Turns a Slack failure that happened before anything was written into a typed
 * failure with no side effect. The message names Slack's code, never its body.
 */
function failSlackStep(
  error: unknown,
  operation: SlackOperation,
  what: string,
): never {
  failIfSlackNotReady(error);
  const code = slackApiCode(error);
  const status = slackHttpStatus(error);
  if (code === "ratelimited" || status === 429) {
    return failWorkflowAction({
      message: `Slack is rate limiting this workspace while ${what}.`,
      errorCode: "slack_rate_limited",
      statusCode: 429,
      retryable: true,
    });
  }
  if (code && NOT_FOUND_CODES.has(code)) {
    return failWorkflowAction({
      message: `Slack could not find ${what} (${code}). Check the channel id and that the bot is in the channel.`,
      errorCode: "slack_not_found",
      statusCode: 404,
      details: { slackError: code },
    });
  }
  if (code && ACCESS_CODES.has(code)) {
    return failWorkflowAction({
      message: `Slack refused the connected credential while ${what} (${code}).`,
      errorCode: "slack_access_denied",
      statusCode: 403,
      details: { slackError: code },
    });
  }
  return failWorkflowAction({
    message: `Slack failed while ${what}${code ? ` (${code})` : status ? ` (HTTP ${status})` : ""}.`,
    errorCode: `slack_${operation}_failed`,
    statusCode: 424,
    retryable: status === null || status >= 500,
    details: {
      ...(code ? { slackError: code } : {}),
      ...(status ? { status } : {}),
    },
  });
}

interface ThreadReaction {
  name: string;
  count: number;
  users: string[];
  usersTruncated?: true;
}

interface WorkflowThreadMessage {
  ts: string;
  user: string | null;
  username: string | null;
  botId: string | null;
  isBot: boolean;
  text: string;
  textTruncated?: true;
  reactions: ThreadReaction[];
}

interface WorkflowThreadResult {
  channel: string;
  threadTs: string;
  messages: WorkflowThreadMessage[];
  /** Messages in the thread after the `oldest` filter, before the size cut. */
  messageCount: number;
  truncated: boolean;
  omittedMessages: number;
  /** When truncated: pass this as `oldest` to read the rest. */
  nextOldest: string | null;
}

function shapeMessage(message: SlackMessage): WorkflowThreadMessage {
  const text = clipText(message.text ?? "", SLACK_MESSAGE_TEXT_LIMIT);
  return {
    ts: message.ts,
    user: message.user ?? null,
    username: message.username ?? null,
    botId: message.bot_id ?? null,
    isBot: Boolean(message.bot_id),
    text: text.text,
    ...(text.clipped ? { textTruncated: true as const } : {}),
    reactions: (message.reactions ?? []).map((reaction) => {
      const users = reaction.users ?? [];
      return {
        name: reaction.name,
        count: reaction.count ?? users.length,
        users: users.slice(0, REACTION_USERS_LIMIT),
        ...(users.length > REACTION_USERS_LIMIT
          ? { usersTruncated: true as const }
          : {}),
      };
    }),
  };
}

/**
 * Reads a whole thread. A thread Slack could not finish paging is an error,
 * never a short success: the caller would act on a thread that is missing its
 * newest replies.
 */
export async function readWorkflowSlackThread(
  slack: SlackReader,
  input: {
    workspace: Workspace;
    channel: string;
    threadTs: string;
    oldest?: string;
  },
): Promise<WorkflowThreadResult> {
  let thread: { messages: SlackMessage[]; hasMore: boolean };
  try {
    thread = await slack.getCompleteThread(
      input.workspace,
      input.channel,
      input.threadTs,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /pagination is incomplete/i.test(error.message)
    ) {
      return failWorkflowAction({
        message:
          "Slack did not give a cursor for the rest of the thread, so it cannot be read in full.",
        errorCode: "slack_thread_incomplete",
        statusCode: 424,
        retryable: true,
      });
    }
    return failSlackStep(error, "read", "reading the thread");
  }
  if (thread.hasMore) {
    return failWorkflowAction({
      message:
        "The thread is longer than Factory pages in one read, so it cannot be read in full.",
      errorCode: "slack_thread_incomplete",
      statusCode: 424,
    });
  }
  if (thread.messages.length === 0) {
    return failWorkflowAction({
      message: "Slack returned no messages for this thread.",
      errorCode: "slack_not_found",
      statusCode: 404,
    });
  }
  const { oldest } = input;
  const after = oldest
    ? thread.messages.filter(
        (message) => compareSlackTs(message.ts, oldest) > 0,
      )
    : thread.messages;
  const shaped = after.map(shapeMessage);
  const { kept, truncated } = takeWithinBudget(
    shaped,
    WORKFLOW_ACTION_OUTPUT_BUDGET_CHARS,
    400,
  );
  return {
    channel: input.channel,
    threadTs: input.threadTs,
    messages: kept,
    messageCount: shaped.length,
    truncated: truncated || kept.some((message) => message.textTruncated),
    omittedMessages: shaped.length - kept.length,
    nextOldest: truncated
      ? (kept[kept.length - 1]?.ts ?? input.oldest ?? null)
      : null,
  };
}

type SlackRecipient =
  | { kind: "channel"; id: string }
  | { kind: "user"; id: string }
  | { kind: "email"; email: string };

export function classifySlackRecipient(
  to: string,
  inThread: boolean,
): SlackRecipient {
  const value = to.trim();
  const recipient: SlackRecipient | null = isSlackChannelId(value)
    ? { kind: "channel", id: value }
    : SLACK_USER_ID.test(value)
      ? { kind: "user", id: value }
      : EMAIL.test(value)
        ? { kind: "email", email: value }
        : null;
  if (!recipient) {
    return failWorkflowAction({
      message:
        "The recipient is not a Slack channel id (C...), a person id (U...), or an email address.",
      errorCode: "slack_recipient_invalid",
      statusCode: 400,
    });
  }
  if (inThread && recipient.kind !== "channel") {
    return failWorkflowAction({
      message:
        "A thread reply goes to the thread's channel id, not to a person or an email address.",
      errorCode: "slack_recipient_invalid",
      statusCode: 400,
    });
  }
  return recipient;
}

/**
 * Slack turns `<!channel>`, `<!here>`, `<!everyone>`, `<!subteam^...>` and
 * `<@U...>` into notifications. Escaping the `<` makes Slack show the text as
 * typed; links (`<https://...|label>`) and channel links (`<#C...>`) are left
 * alone.
 */
export function neutralizeSlackMentions(text: string): string {
  return text.replace(SLACK_PING_OPEN, "&lt;");
}

interface WorkflowSlackPost {
  channel: string;
  ts: string;
  threadTs: string | null;
  permalink: string | null;
  permalinkError?: string;
  recipient: SlackRecipient;
}

/**
 * Posts one message. Everything before the write fails with no side effect; a
 * failure of the write itself is `rejected` (Slack said no) or unknown (the
 * request may have been delivered), because Slack has no idempotency key and a
 * blind retry would post twice.
 */
export async function postWorkflowSlackMessage(
  slack: SlackReader,
  input: {
    workspace: Workspace;
    to: string;
    text: string;
    threadTs?: string;
    /** Post `<!channel>`, `<!here>` and `<@U...>` as live notifications. Without it they show as plain text, because the text may be model-written or quoted from a customer. */
    allowMentions?: boolean;
  },
): Promise<WorkflowSlackPost> {
  const recipient = classifySlackRecipient(input.to, Boolean(input.threadTs));
  const text = input.allowMentions
    ? input.text
    : neutralizeSlackMentions(input.text);
  if (text.length > SLACK_POST_TEXT_MAX) {
    return failWorkflowAction({
      message: `The message is over ${SLACK_POST_TEXT_MAX} characters once its mentions are escaped, so Slack could cut it; shorten it.`,
      errorCode: "slack_text_too_long",
      statusCode: 400,
    });
  }
  try {
    await slack.verifyAgentNativeIdentity(input.workspace);
  } catch (error) {
    failSlackStep(error, "post", "checking the Slack identity");
  }

  let channel: string;
  if (recipient.kind === "email") {
    let found;
    try {
      found = await slack.findUserByEmail(input.workspace, recipient.email);
    } catch (error) {
      return failSlackStep(
        error,
        "lookup",
        "looking up the recipient by email",
      );
    }
    if (!found) {
      return failWorkflowAction({
        message: `Slack has no member with the email ${recipient.email}.`,
        errorCode: "slack_user_not_found",
        statusCode: 404,
      });
    }
    if (found.deleted || found.isBot) {
      return failWorkflowAction({
        message: `The Slack account for ${recipient.email} is deactivated or a bot, so it cannot be messaged.`,
        errorCode: "slack_user_unreachable",
        statusCode: 422,
      });
    }
    channel = found.id;
  } else {
    channel = recipient.id;
  }

  let posted;
  try {
    posted = input.threadTs
      ? await slack.postThreadReply(
          input.workspace,
          channel,
          input.threadTs,
          text,
        )
      : await slack.postChannelMessage(input.workspace, channel, text);
  } catch (error) {
    if (error instanceof SlackWriteError && error.delivery === "rejected") {
      const code = slackApiCode(error);
      const limited =
        error.retryAfterSeconds !== null ||
        code === "ratelimited" ||
        slackHttpStatus(error) === 429;
      return failWorkflowAction({
        message: `Slack rejected the message${code ? ` (${code})` : ""}; nothing was posted.`,
        errorCode: limited ? "slack_rate_limited" : "slack_post_rejected",
        statusCode: limited ? 429 : 424,
        retryable: limited,
        details: {
          ...(code ? { slackError: code } : {}),
          ...(error.retryAfterSeconds !== null
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {}),
        },
      });
    }
    return failWorkflowAction({
      message: "Slack did not confirm whether the message was posted.",
      errorCode: "slack_post_outcome_unknown",
      statusCode: 424,
    });
  }
  if (!posted.ts || !posted.channel) {
    return failWorkflowAction({
      message: "Slack answered without the posted message's identity.",
      errorCode: "slack_post_outcome_unknown",
      statusCode: 424,
    });
  }

  const post: WorkflowSlackPost = {
    channel: posted.channel,
    ts: posted.ts,
    threadTs: input.threadTs ?? null,
    permalink: null,
    recipient,
  };
  // The message is out. A missing link must not fail a write that happened.
  try {
    post.permalink = await slack.getMessagePermalink(
      input.workspace,
      posted.channel,
      posted.ts,
    );
  } catch (error) {
    post.permalinkError = slackApiCode(error) ?? "permalink_unavailable";
  }
  return post;
}
