import { describe, expect, it, vi } from "vitest";

import type { Clock, ThreadReplyRequest } from "../workflow/adapter.js";
import type { GuardedActionCall, GuardedActionResult } from "./inbox.js";
import {
  READ_SLACK_THREAD_ACTION,
  createThreadReader,
  type MemberLookup,
} from "./thread-reader.js";

const SINCE = "2026-10-18T10:00:00.000Z";
// Slack timestamps for instants around SINCE (epoch 1792317600).
const BEFORE = "1792317599.000100";
const AT_SINCE = "1792317600.000000";
const AFTER_1 = "1792317660.000100";
const AFTER_2 = "1792317720.000200";
const NOW = new Date("2026-10-18T10:30:00.000Z");

const clock: Clock = {
  now: () => NOW,
  sleep: async () => {},
};

interface Msg {
  ts: string;
  user?: string | null;
  isBot?: boolean;
  text?: string;
  reactions?: {
    name: string;
    count?: number;
    users?: string[];
    usersTruncated?: true;
  }[];
}

function message(msg: Msg) {
  return {
    ts: msg.ts,
    user: msg.user === undefined ? "U_HUMAN" : msg.user,
    username: null,
    botId: msg.isBot ? "B1" : null,
    isBot: msg.isBot ?? false,
    text: msg.text ?? "hello",
    reactions: (msg.reactions ?? []).map((reaction) => ({
      name: reaction.name,
      count: reaction.count ?? reaction.users?.length ?? 1,
      users: reaction.users ?? ["U_HUMAN"],
      ...(reaction.usersTruncated ? { usersTruncated: true } : {}),
    })),
  };
}

function output(
  messages: Msg[],
  extra: {
    truncated?: boolean;
    omittedMessages?: number;
    nextOldest?: string | null;
    coverage?: string;
  } = {},
): GuardedActionResult {
  return {
    status: "completed",
    output: JSON.stringify({
      ok: true,
      coverage: extra.coverage ?? "complete",
      channel: "C1",
      threadTs: "1792317000.000000",
      messages: messages.map(message),
      messageCount: messages.length,
      truncated: extra.truncated ?? false,
      omittedMessages: extra.omittedMessages ?? 0,
      nextOldest: extra.nextOldest ?? null,
    }),
  };
}

const THREAD = { channelId: "C1", threadTs: "1792317000.000000" };

function request(
  overrides: Partial<ThreadReplyRequest> = {},
): ThreadReplyRequest {
  return {
    thread: THREAD,
    since: SINCE,
    acceptFrom: "anyone",
    ackReaction: "white_check_mark",
    ownerEmail: "owner@example.test",
    signal: new AbortController().signal,
    ...overrides,
  };
}

function reader(
  script: (call: GuardedActionCall) => GuardedActionResult,
  members: Record<string, MemberLookup | Error> = {},
) {
  const calls: GuardedActionCall[] = [];
  const lookups: string[] = [];
  const log = vi.fn();
  const threads = createThreadReader({
    callAction: async (call) => {
      calls.push(call);
      return script(call);
    },
    factoryId: "factory-1",
    lookupMember: async (email) => {
      lookups.push(email);
      const found = members[email];
      if (found instanceof Error) throw found;
      return found ?? { found: false, reason: "no_such_member" };
    },
    clock,
    log,
  });
  return { threads, calls, lookups, log };
}

describe("reading replies on a Slack thread", () => {
  it("counts human messages after the wait began and drops bots, the root, and earlier messages", async () => {
    const { threads } = reader(() =>
      output([
        { ts: BEFORE, text: "before" },
        { ts: AT_SINCE, text: "at the instant" },
        { ts: AFTER_1, user: "U_ANA", text: "first answer" },
        { ts: AFTER_1.replace(".000100", ".000200"), isBot: true, user: null },
        {
          ts: AFTER_1.replace(".000100", ".000300"),
          isBot: true,
          user: "U_BOT",
        },
        { ts: AFTER_1.replace(".000100", ".000400"), user: null },
        { ts: AFTER_2, user: "U_BOB", text: "x".repeat(2_000) },
      ]),
    );

    const result = await threads.readReplies(request());

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("unreachable");
    expect(result.replies.map((reply) => reply.id)).toEqual([
      `message:${AFTER_1}`,
      `message:${AFTER_2}`,
    ]);
    expect(result.replies[0]).toMatchObject({
      kind: "message",
      author: "U_ANA",
      text: "first answer",
      at: "2026-10-18T10:01:00.000Z",
    });
    expect(result.replies[1]?.text?.length).toBeLessThanOrEqual(1_003);
  });

  it("says nobody answered only after reading the whole thread", async () => {
    const { threads, lookups } = reader(() =>
      output([{ ts: BEFORE }, { ts: AFTER_1, isBot: true, user: null }]),
    );

    expect(
      await threads.readReplies(
        request({ acceptFrom: { emails: ["a@example.test"] } }),
      ),
    ).toEqual({ ok: true, replies: [] });
    // Nobody had answered, so nobody needed to be looked up.
    expect(lookups).toEqual([]);
  });

  it("asks the action for the thread with the factory, the channel and a start just before the wait began", async () => {
    const signal = new AbortController().signal;
    const { threads, calls } = reader(() => output([]));

    await threads.readReplies(request({ signal }));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: READ_SLACK_THREAD_ACTION,
      input: {
        factoryId: "factory-1",
        channel: "C1",
        threadTs: "1792317000.000000",
        oldest: "1792317599.999999",
      },
      signal,
    });
  });

  describe("the ack reaction", () => {
    it("counts when it sits on a message at or after the wait began", async () => {
      const { threads } = reader(() =>
        output([
          {
            ts: BEFORE,
            reactions: [{ name: "white_check_mark", users: ["U_ANA"] }],
          },
          {
            ts: AFTER_1,
            isBot: true,
            user: null,
            reactions: [
              { name: "white_check_mark", users: ["U_ANA"] },
              { name: "eyes", users: ["U_BOB"] },
            ],
          },
        ]),
      );

      const result = await threads.readReplies(request());

      expect(result).toEqual({
        ok: true,
        replies: [
          {
            id: `reaction:${AFTER_1}:white_check_mark`,
            at: NOW.toISOString(),
            kind: "reaction",
            author: "U_ANA",
          },
        ],
      });
    });

    it("counts only the reaction the node names, and only from the people it names", async () => {
      const { threads } = reader(
        () =>
          output([
            {
              ts: AFTER_1,
              isBot: true,
              user: null,
              reactions: [
                { name: "thumbsup", users: ["U_OWNER"] },
                { name: "white_check_mark", users: ["U_OTHER"] },
              ],
            },
          ]),
        { "owner@example.test": { found: true, id: "U_OWNER" } },
      );

      expect(
        await threads.readReplies(request({ acceptFrom: "owner" })),
      ).toEqual({ ok: true, replies: [] });
      expect(
        await threads.readReplies(
          request({ acceptFrom: "owner", ackReaction: "thumbsup" }),
        ),
      ).toMatchObject({
        ok: true,
        replies: [{ kind: "reaction", author: "U_OWNER" }],
      });
    });

    it("is a failed read when Slack listed only some of the people on it and none of them may answer", async () => {
      const { threads } = reader(
        () =>
          output([
            {
              ts: AFTER_1,
              isBot: true,
              user: null,
              reactions: [
                {
                  name: "white_check_mark",
                  count: 40,
                  users: ["U_1", "U_2"],
                  usersTruncated: true,
                },
              ],
            },
          ]),
        { "owner@example.test": { found: true, id: "U_OWNER" } },
      );

      const result = await threads.readReplies(
        request({ acceptFrom: "owner" }),
      );

      expect(result).toMatchObject({
        ok: false,
        code: "provider_error",
        retryable: false,
      });
      expect(result.ok === false && result.message).toMatch(/partial_read/);
    });
  });

  describe("acceptFrom", () => {
    it("takes the one person in a direct message as the owner, without a lookup", async () => {
      const { threads, lookups } = reader(() =>
        output([{ ts: AFTER_1, user: "U_THE_PERSON" }]),
      );

      const result = await threads.readReplies(
        request({
          thread: { channelId: "D123", threadTs: "1792317000.000000" },
          acceptFrom: "owner",
        }),
      );

      expect(result).toMatchObject({
        ok: true,
        replies: [{ author: "U_THE_PERSON" }],
      });
      expect(lookups).toEqual([]);
    });

    it("takes the workflow owner's account in a channel and nobody else's", async () => {
      const { threads, lookups } = reader(
        () =>
          output([
            { ts: AFTER_1, user: "U_STRANGER", text: "not me" },
            { ts: AFTER_2, user: "U_OWNER", text: "me" },
          ]),
        { "owner@example.test": { found: true, id: "U_OWNER" } },
      );

      const result = await threads.readReplies(
        request({ acceptFrom: "owner" }),
      );

      expect(result).toMatchObject({
        ok: true,
        replies: [{ author: "U_OWNER", text: "me" }],
      });
      expect(lookups).toEqual(["owner@example.test"]);
    });

    it("matches a listed email case-insensitively, looks each one up once across reads, and reports a person Slack cannot find only when it matters", async () => {
      const { threads, lookups, log } = reader(
        () => output([{ ts: AFTER_1, user: "U_ANA" }]),
        {
          "ana@example.test": { found: true, id: "U_ANA" },
          "gone@example.test": { found: false, reason: "deactivated" },
        },
      );
      const acceptFrom = {
        emails: ["ana@example.test", "Ana@Example.test", "gone@example.test"],
      };

      const first = await threads.readReplies(request({ acceptFrom }));
      const second = await threads.readReplies(request({ acceptFrom }));

      expect(first).toMatchObject({ ok: true, replies: [{ author: "U_ANA" }] });
      expect(second).toMatchObject({ ok: true });
      expect(lookups).toEqual(["ana@example.test", "gone@example.test"]);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(
          "reply_account_unmatched: gone@example.test (deactivated)",
        ),
      );
    });

    it("fails, never times out, when someone replied and the only people allowed to answer cannot be matched to Slack accounts", async () => {
      const { threads } = reader(
        () => output([{ ts: AFTER_1, user: "U_SOMEONE" }]),
        { "ghost@example.test": { found: false, reason: "no_such_member" } },
      );

      const result = await threads.readReplies(
        request({ acceptFrom: { emails: ["ghost@example.test"] } }),
      );

      expect(result).toMatchObject({
        ok: false,
        code: "provider_error",
        retryable: false,
      });
      expect(result.ok === false && result.message).toContain(
        "ghost@example.test (no Slack member)",
      );
    });

    it("fails an unresolvable workflow owner the same way", async () => {
      const { threads } = reader(() =>
        output([{ ts: AFTER_1, user: "U_SOMEONE" }]),
      );

      const result = await threads.readReplies(
        request({ acceptFrom: "owner" }),
      );

      expect(result).toMatchObject({ ok: false, code: "provider_error" });
      expect(result.ok === false && result.message).toContain(
        "owner@example.test (no Slack member)",
      );
    });

    it("tells a missing Slack scope from a lookup that may work next time", async () => {
      const scope = reader(() => output([{ ts: AFTER_1 }]), {
        "a@example.test": new Error("Slack API error: missing_scope"),
      });
      expect(
        await scope.threads.readReplies(
          request({ acceptFrom: { emails: ["a@example.test"] } }),
        ),
      ).toMatchObject({
        ok: false,
        code: "credential_missing",
        retryable: false,
      });

      const flaky = reader(() => output([{ ts: AFTER_1 }]), {
        "a@example.test": new Error("socket hang up"),
      });
      const acceptFrom = { emails: ["a@example.test"] };
      expect(
        await flaky.threads.readReplies(request({ acceptFrom })),
      ).toMatchObject({ ok: false, code: "provider_error", retryable: true });
      // A failed lookup is asked again rather than remembered.
      await flaky.threads.readReplies(request({ acceptFrom }));
      expect(flaky.lookups).toHaveLength(2);
    });
  });

  describe("a read that did not finish is never a short list", () => {
    it("fails with the action's typed failure and says whether trying again can help", async () => {
      const failed = (errorCode: string | undefined, output = "no") =>
        reader(() => ({
          status: "failed",
          output,
          ...(errorCode ? { errorCode } : {}),
        })).threads.readReplies(request());

      expect(await failed("workflow_action_not_allowed")).toMatchObject({
        ok: false,
        code: "operation_not_allowed",
        retryable: false,
      });
      expect(await failed("slack_not_connected")).toMatchObject({
        ok: false,
        code: "credential_missing",
        retryable: false,
      });
      expect(await failed("slack_thread_incomplete")).toMatchObject({
        ok: false,
        code: "provider_error",
        retryable: true,
      });
      expect(await failed("slack_not_found")).toMatchObject({
        ok: false,
        code: "provider_error",
        retryable: false,
      });
      expect(await failed(undefined, "socket hang up")).toMatchObject({
        ok: false,
        code: "provider_error",
        retryable: true,
      });
      expect(
        await reader(() => ({
          status: "approval_required",
          output: "?",
        })).threads.readReplies(request()),
      ).toMatchObject({ ok: false, code: "operation_not_allowed" });
    });

    it("fails on output that is not JSON or does not say the thread is complete", async () => {
      for (const body of [
        { status: "completed" as const, output: "not json" },
        output([{ ts: AFTER_1 }], { coverage: "partial" }),
        {
          status: "completed" as const,
          output: '{"ok":true,"coverage":"compl',
        },
      ]) {
        const result = await reader(() => body).threads.readReplies(request());
        expect(result).toMatchObject({
          ok: false,
          code: "provider_error",
          retryable: false,
        });
      }
    });

    it("reads on when the action cut the thread, and joins the pages", async () => {
      const { threads, calls } = reader((call) =>
        call.input.oldest === "1792317599.999999"
          ? output([{ ts: AFTER_1, user: "U_ANA" }], {
              truncated: true,
              omittedMessages: 1,
              nextOldest: AFTER_1,
            })
          : output([{ ts: AFTER_2, user: "U_BOB" }]),
      );

      const result = await threads.readReplies(request());

      expect(result).toMatchObject({
        ok: true,
        replies: [{ author: "U_ANA" }, { author: "U_BOB" }],
      });
      expect(calls.map((call) => call.input.oldest)).toEqual([
        "1792317599.999999",
        AFTER_1,
      ]);
    });

    it("fails when a cut thread gives no way to read on, or never ends", async () => {
      const stuck = reader(() =>
        output([{ ts: AFTER_1 }], {
          truncated: true,
          omittedMessages: 3,
          nextOldest: null,
        }),
      );
      const stuckResult = await stuck.threads.readReplies(request());
      expect(stuckResult).toMatchObject({ ok: false, code: "provider_error" });
      expect(stuckResult.ok === false && stuckResult.message).toMatch(
        /partial_read.*3 messages unread/,
      );

      let n = 0;
      const endless = reader(() => {
        n += 1;
        return output([{ ts: `${1792317700 + n}.000000` }], {
          truncated: true,
          omittedMessages: 1,
          nextOldest: `${1792317700 + n}.000000`,
        });
      });
      const endlessResult = await endless.threads.readReplies(request());
      expect(endlessResult).toMatchObject({
        ok: false,
        code: "provider_error",
      });
      expect(endless.calls).toHaveLength(10);
      expect(endlessResult.ok === false && endlessResult.message).toMatch(
        /partial_read/,
      );

      const noProgress = reader(() =>
        output([{ ts: AFTER_1 }], {
          truncated: true,
          omittedMessages: 1,
          nextOldest: BEFORE,
        }),
      );
      expect(await noProgress.threads.readReplies(request())).toMatchObject({
        ok: false,
      });
      expect(noProgress.calls).toHaveLength(1);
    });
  });

  it("does not read a pull request or a ticket as a Slack thread", async () => {
    const { threads, calls } = reader(() => output([]));

    for (const thread of [
      { repo: "acme/web", number: 7 },
      { ticketId: "T-1" },
    ]) {
      expect(await threads.readReplies(request({ thread }))).toMatchObject({
        ok: false,
        code: "provider_error",
        retryable: false,
      });
    }
    expect(calls).toEqual([]);
  });
});
