import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  Clock,
  ThreadReader,
  ThreadReply,
  ThreadReplyRequest,
  ThreadReplyResult,
} from "../workflow/adapter.js";
import type { WorkflowErrorCode } from "../workflow/contract.js";
import type { GuardedActionCaller, GuardedActionResult } from "./inbox.js";

/** The action that reads a Slack thread with each message's reactions. */
export const READ_SLACK_THREAD_ACTION = "read-slack-thread";

const MAX_PAGES = 10;
const UNMATCHED_REASON = {
  no_such_member: "no Slack member",
  deactivated: "deactivated",
  bot: "a bot account",
} as const;
const REPLY_TEXT_LIMIT = 1_000;
const MAX_ERROR_TEXT_CHARS = 500;

/** What a Slack member lookup by email found. Throws when it could not ask. */
export type MemberLookup =
  | { found: true; id: string }
  | { found: false; reason: "no_such_member" | "deactivated" | "bot" };

interface ThreadReaderOptions {
  /** Runs the read through the gated action path, as the workflow job. */
  callAction: GuardedActionCaller;
  /** The factory the job lives in, so the action is told rather than left to infer it. */
  factoryId: string;
  /** Resolves an email to a Slack member; only called when someone has answered. */
  lookupMember: (email: string, signal: AbortSignal) => Promise<MemberLookup>;
  clock: Clock;
  /** Where an unmatched account is reported besides the failure. */
  log?: (message: string) => void;
}

const reactionSchema = z.object({
  name: z.string(),
  count: z.number(),
  users: z.array(z.string()),
  usersTruncated: z.literal(true).optional(),
});

const messageSchema = z.object({
  ts: z.string().regex(/^\d{1,12}\.\d{1,9}$/),
  user: z.string().nullable(),
  isBot: z.boolean(),
  text: z.string(),
  reactions: z.array(reactionSchema),
});

const threadSchema = z.object({
  ok: z.literal(true),
  coverage: z.literal("complete"),
  messages: z.array(messageSchema),
  truncated: z.boolean(),
  omittedMessages: z.number(),
  nextOldest: z.string().nullable(),
});

type SlackMessage = z.infer<typeof messageSchema>;

function failure(
  code: WorkflowErrorCode,
  message: string,
  retryable: boolean,
): Extract<ThreadReplyResult, { ok: false }> {
  return { ok: false, code, message, retryable };
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

/** A Slack timestamp as whole microseconds, so two of them compare exactly. */
function slackMicros(ts: string): bigint {
  const [seconds = "0", fraction = ""] = ts.split(".");
  return (
    BigInt(seconds) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6))
  );
}

function slackTsFromMicros(micros: bigint): string {
  const seconds = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0");
  return `${seconds}.${fraction}`;
}

function instantMicros(iso: string): bigint {
  return BigInt(Date.parse(iso)) * 1_000n;
}

function instantOfSlackTs(ts: string): string {
  return new Date(Number(slackMicros(ts) / 1_000n)).toISOString();
}

const ACCESS_CODES = new Set([
  "slack_not_connected",
  "slack_identity_mismatch",
  "slack_access_denied",
]);
const TRANSIENT_CODES = new Set([
  "slack_rate_limited",
  "slack_thread_incomplete",
  "slack_read_failed",
]);

function actionFailure(
  result: GuardedActionResult,
): Extract<ThreadReplyResult, { ok: false }> {
  const text = clip(result.output, MAX_ERROR_TEXT_CHARS);
  const code = result.errorCode;
  if (result.status === "approval_required") {
    return failure(
      "operation_not_allowed",
      `${READ_SLACK_THREAD_ACTION} asked for approval, which a workflow cannot give.`,
      false,
    );
  }
  if (code === "workflow_action_not_allowed") {
    return failure(
      "operation_not_allowed",
      `${READ_SLACK_THREAD_ACTION} was refused for this workflow: ${text}`,
      false,
    );
  }
  if (code !== undefined && ACCESS_CODES.has(code)) {
    return failure(
      "credential_missing",
      `${READ_SLACK_THREAD_ACTION} could not use Slack (${code}): ${text}`,
      false,
    );
  }
  return failure(
    "provider_error",
    `${READ_SLACK_THREAD_ACTION} failed${code ? ` (${code})` : ""}: ${text}`,
    code === undefined || TRANSIENT_CODES.has(code),
  );
}

type Page = z.infer<typeof threadSchema>;

function parsePage(
  output: string,
): Page | Extract<ThreadReplyResult, { ok: false }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return failure(
      "provider_error",
      `${READ_SLACK_THREAD_ACTION} returned a result that is not JSON, so the thread was not read in full: ${clip(output, 200)}`,
      false,
    );
  }
  const page = threadSchema.safeParse(parsed);
  if (!page.success) {
    const issue = page.error.issues[0];
    return failure(
      "provider_error",
      `${READ_SLACK_THREAD_ACTION} did not report a complete thread (${issue?.path.join(".") || "(root)"}: ${issue?.message}).`,
      false,
    );
  }
  return page.data;
}

/** An account an acceptable reply may come from. */
interface Acceptor {
  /** Everyone counts. */
  anyone: boolean;
  ids: ReadonlySet<string>;
  /** Emails Slack could not match to a live account, with why. */
  unmatched: readonly string[];
}

function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Reads the replies a reply Wait is waiting for. It reads the whole thread
 * through `read-slack-thread` (so the graph's gate, the audit, and the
 * credential checks all apply), then decides which messages and reactions
 * count. A thread that could not be read in full, an action that failed, and a
 * listed person Slack cannot find are all `ok: false`: a Wait that timed an item
 * out on any of them would be saying nobody answered when nobody could be heard.
 */
export function createThreadReader(options: ThreadReaderOptions): ThreadReader {
  const log = options.log ?? ((message) => console.warn(message));
  const members = new Map<string, Promise<MemberLookup>>();

  function lookup(email: string, signal: AbortSignal): Promise<MemberLookup> {
    const key = email.trim().toLowerCase();
    let found = members.get(key);
    if (!found) {
      found = options.lookupMember(email, signal);
      members.set(key, found);
      // A failed lookup is not remembered: the next read asks again.
      found.catch(() => members.delete(key));
    }
    return found;
  }

  async function readThread(
    request: ThreadReplyRequest,
    channel: string,
    threadTs: string,
  ): Promise<
    { messages: SlackMessage[] } | Extract<ThreadReplyResult, { ok: false }>
  > {
    const sinceMicros = instantMicros(request.since);
    // The action keeps messages strictly after `oldest`; one microsecond
    // earlier keeps a message posted at exactly `since`, whose reactions count.
    let oldest: string | undefined = slackTsFromMicros(
      sinceMicros > 0n ? sinceMicros - 1n : 0n,
    );
    const messages: SlackMessage[] = [];
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      const result = await options.callAction({
        name: READ_SLACK_THREAD_ACTION,
        input: {
          factoryId: options.factoryId,
          channel,
          threadTs,
          ...(oldest === undefined ? {} : { oldest }),
        },
        callId: `thread:${randomUUID()}`,
        signal: request.signal,
      });
      if (result.status !== "completed") return actionFailure(result);
      const page = parsePage(result.output);
      if (!("messages" in page)) return page;
      messages.push(...page.messages);
      if (page.omittedMessages === 0) return { messages };
      const next = page.nextOldest;
      if (
        next === null ||
        (oldest !== undefined && slackMicros(next) <= slackMicros(oldest))
      ) {
        return failure(
          "provider_error",
          `partial_read: ${READ_SLACK_THREAD_ACTION} left ${page.omittedMessages} messages unread and gave no way to read on, so the thread was not read in full.`,
          false,
        );
      }
      oldest = next;
    }
    return failure(
      "provider_error",
      `partial_read: the thread has more than ${MAX_PAGES} pages of replies, so it was not read in full.`,
      false,
    );
  }

  async function acceptor(
    request: ThreadReplyRequest,
    channel: string,
  ): Promise<Acceptor | Extract<ThreadReplyResult, { ok: false }>> {
    const { acceptFrom } = request;
    if (acceptFrom === "anyone") {
      return { anyone: true, ids: new Set(), unmatched: [] };
    }
    // A direct message is a thread with one person, and that person is who
    // `owner` means; nobody else can be in it but the bot.
    if (acceptFrom === "owner" && channel.startsWith("D")) {
      return { anyone: true, ids: new Set(), unmatched: [] };
    }
    const emails =
      acceptFrom === "owner" ? [request.ownerEmail] : [...acceptFrom.emails];
    const unique = emails.filter(
      (email, index) => emails.findIndex((e) => sameEmail(e, email)) === index,
    );
    const ids = new Set<string>();
    const unmatched: string[] = [];
    for (const email of unique) {
      let member: MemberLookup;
      try {
        member = await lookup(email, request.signal);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        const access =
          /missing_scope|invalid_auth|token_revoked|not_allowed_token_type|No Slack bot token configured/.test(
            text,
          );
        return failure(
          access ? "credential_missing" : "provider_error",
          `Could not look up ${email} in Slack to tell whether they replied: ${clip(text, MAX_ERROR_TEXT_CHARS)}`,
          !access,
        );
      }
      if (member.found) ids.add(member.id);
      else unmatched.push(`${email} (${UNMATCHED_REASON[member.reason]})`);
    }
    return { anyone: false, ids, unmatched };
  }

  return {
    async readReplies(request) {
      const { thread } = request;
      if (thread.channelId === undefined || thread.threadTs === undefined) {
        return failure(
          "provider_error",
          "Replies can only be read on a Slack thread so far; this item's thread is a pull request or a ticket.",
          false,
        );
      }
      const { channelId: channel, threadTs } = thread;
      const read = await readThread(request, channel, threadTs);
      if (!("messages" in read)) return read;

      const sinceMicros = instantMicros(request.since);
      const humans = read.messages.filter(
        (message) =>
          !message.isBot &&
          message.user !== null &&
          slackMicros(message.ts) > sinceMicros,
      );
      // Slack gives a reaction no time, so one counts by the message it is on.
      const reacted = read.messages.filter(
        (message) =>
          slackMicros(message.ts) >= sinceMicros &&
          message.reactions.some(
            (reaction) =>
              reaction.name === request.ackReaction && reaction.count > 0,
          ),
      );
      if (humans.length === 0 && reacted.length === 0) {
        return { ok: true, replies: [] };
      }

      const accept = await acceptor(request, channel);
      if ("ok" in accept) return accept;

      const replies: ThreadReply[] = [];
      for (const message of humans) {
        const user = message.user as string;
        if (!accept.anyone && !accept.ids.has(user)) continue;
        replies.push({
          id: `message:${message.ts}`,
          at: instantOfSlackTs(message.ts),
          kind: "message",
          author: user,
          text: clip(message.text, REPLY_TEXT_LIMIT),
        });
      }
      let reactorsCut = false;
      const seen = options.clock.now().toISOString();
      for (const message of reacted) {
        for (const reaction of message.reactions) {
          if (reaction.name !== request.ackReaction || reaction.count <= 0) {
            continue;
          }
          const reactor = accept.anyone
            ? reaction.users[0]
            : reaction.users.find((user) => accept.ids.has(user));
          if (accept.anyone || reactor !== undefined) {
            replies.push({
              id: `reaction:${message.ts}:${reaction.name}`,
              at: seen,
              kind: "reaction",
              ...(reactor === undefined ? {} : { author: reactor }),
            });
          } else if (reaction.usersTruncated) {
            reactorsCut = true;
          }
        }
      }

      if (replies.length > 0) {
        if (accept.unmatched.length > 0) {
          log(
            `[workflow-thread-reader] reply_account_unmatched: ${accept.unmatched.join(", ")} could not be matched to a Slack account, so replies from them are not recognised.`,
          );
        }
        return { ok: true, replies };
      }
      if (accept.unmatched.length > 0) {
        return failure(
          "provider_error",
          `reply_account_unmatched: ${accept.unmatched.join(", ")} could not be matched to a Slack account, so a reply from them would not be recognised and the wait cannot tell whether they answered.`,
          false,
        );
      }
      if (reactorsCut) {
        return failure(
          "provider_error",
          `partial_read: the ${request.ackReaction} reaction has more people on it than Slack listed, so it cannot be told whether one of them is among those who may answer.`,
          false,
        );
      }
      return { ok: true, replies: [] };
    },
  };
}
