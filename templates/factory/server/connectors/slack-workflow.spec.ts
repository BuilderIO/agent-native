import { beforeEach, describe, expect, it, vi } from "vitest";

const readCallingMock = vi.hoisted(() => vi.fn());
const readConfigRowMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", () => ({ getDb: () => ({}) }));
vi.mock("../lib/factory-automation-caller.js", () => ({
  readCallingFactoryAutomation: readCallingMock,
}));
vi.mock("../lib/factory-scope.js", () => ({
  readTriageConfigRow: readConfigRowMock,
}));

import { UnreadableSecretError } from "../lib/unreadable-secret.js";
import {
  SLACK_MESSAGE_TEXT_LIMIT,
  SLACK_POST_TEXT_MAX,
  classifySlackRecipient,
  compareSlackTs,
  neutralizeSlackMentions,
  postWorkflowSlackMessage,
  readWorkflowSlackThread,
  readWorkflowSlackUserEmail,
  resolveFactorySlackWorkspace,
} from "./slack-workflow.js";
import { SlackWriteError, type SlackMessage } from "./slack.js";

type Reader = Parameters<typeof readWorkflowSlackThread>[0];

function fakeSlack(overrides: Record<string, unknown> = {}) {
  return {
    verifyAgentNativeIdentity: vi.fn().mockResolvedValue(undefined),
    getAgentNativeIdentity: vi.fn().mockResolvedValue({ userId: "UBOT" }),
    getCompleteThread: vi.fn(),
    findUserByEmail: vi.fn(),
    getUserEmail: vi.fn(),
    postChannelMessage: vi.fn(),
    postThreadReply: vi.fn(),
    getMessagePermalink: vi
      .fn()
      .mockResolvedValue("https://example.slack.com/archives/C0123ABCD/p1"),
    ...overrides,
  };
}
const asReader = (slack: ReturnType<typeof fakeSlack>) =>
  slack as unknown as Reader;

function message(ts: string, extra: Partial<SlackMessage> = {}): SlackMessage {
  return { type: "message", text: `message ${ts}`, ts, user: "U1", ...extra };
}

describe("compareSlackTs", () => {
  it("orders timestamps exactly, past what a float can hold", () => {
    expect(compareSlackTs("1700000000.000100", "1700000000.000099")).toBe(1);
    expect(compareSlackTs("1700000000.000100", "1700000000.000100")).toBe(0);
    expect(compareSlackTs("1699999999.999999", "1700000000.000000")).toBe(-1);
    expect(compareSlackTs("1700000000.5", "1700000000.500000")).toBe(0);
  });
});

describe("resolveFactorySlackWorkspace", () => {
  const identity = { userEmail: "owner@example.test", orgId: "org-1" };
  beforeEach(() => {
    readCallingMock.mockReset().mockResolvedValue(null);
    readConfigRowMock.mockReset().mockResolvedValue(undefined);
  });

  it("is primary unless the job or the factory says secondary", async () => {
    await expect(
      resolveFactorySlackWorkspace(undefined, identity, "f1"),
    ).resolves.toBe("primary");
    readCallingMock.mockResolvedValue({
      config: { slackWorkspace: "secondary" },
    });
    await expect(
      resolveFactorySlackWorkspace(undefined, identity, "f1"),
    ).resolves.toBe("secondary");
    readCallingMock.mockResolvedValue(null);
    readConfigRowMock.mockResolvedValue({ slackWorkspace: "secondary" });
    await expect(
      resolveFactorySlackWorkspace(undefined, identity, "f1"),
    ).resolves.toBe("secondary");
  });
});

describe("readWorkflowSlackThread", () => {
  const input = {
    workspace: "primary" as const,
    channel: "C0123ABCD",
    threadTs: "1700000000.000100",
  };

  it("returns the whole thread with reactions and marks a bot message", async () => {
    const slack = fakeSlack({
      getCompleteThread: vi.fn().mockResolvedValue({
        hasMore: false,
        messages: [
          message("1700000000.000100", {
            reactions: [{ name: "eyes", count: 2, users: ["U1", "U2"] }],
          }),
          message("1700000001.000100", { bot_id: "B1", user: undefined }),
        ],
      }),
    });

    const result = await readWorkflowSlackThread(asReader(slack), input);

    expect(result).toMatchObject({
      channel: "C0123ABCD",
      threadTs: "1700000000.000100",
      messageCount: 2,
      truncated: false,
      omittedMessages: 0,
      nextOldest: null,
    });
    expect(result.messages[0]?.reactions).toEqual([
      { name: "eyes", count: 2, users: ["U1", "U2"] },
    ]);
    expect(result.messages[1]).toMatchObject({ isBot: true, botId: "B1" });
  });

  describe("the app's own reactions", () => {
    const read = (reactions: NonNullable<SlackMessage["reactions"]>) =>
      readWorkflowSlackThread(
        asReader(
          fakeSlack({
            getCompleteThread: vi.fn().mockResolvedValue({
              hasMore: false,
              messages: [message("1700000000.000100", { reactions })],
            }),
          }),
        ),
        input,
      ).then((thread) => thread.messages[0]!);

    it("lists the bot's own reaction apart from the reactions of people, so it never reads as a person's claim or reply", async () => {
      const first = await read([{ name: "eyes", count: 1, users: ["UBOT"] }]);

      expect(first.reactions).toEqual([]);
      expect(first.ownReactions).toEqual(["eyes"]);
    });

    it("takes the bot out of a reaction people also made, and keeps the people", async () => {
      const first = await read([
        { name: "eyes", count: 3, users: ["UBOT", "U1", "U2"] },
        { name: "white_check_mark", count: 1, users: ["U3"] },
      ]);

      expect(first.reactions).toEqual([
        { name: "eyes", count: 2, users: ["U1", "U2"] },
        { name: "white_check_mark", count: 1, users: ["U3"] },
      ]);
      expect(first.ownReactions).toEqual(["eyes"]);
    });

    it("says nothing of its own reactions when it made none, so a message keeps its old shape", async () => {
      const first = await read([{ name: "eyes", count: 1, users: ["U1"] }]);

      expect(first).not.toHaveProperty("ownReactions");
      expect(first.reactions).toEqual([
        { name: "eyes", count: 1, users: ["U1"] },
      ]);
    });

    it("does not guess when Slack listed fewer reactors than it counted: the people it did not list stay counted", async () => {
      const first = await read([
        { name: "eyes", count: 40, users: ["U1", "U2"] },
      ]);

      expect(first.reactions).toEqual([
        { name: "eyes", count: 40, users: ["U1", "U2"] },
      ]);
      expect(first).not.toHaveProperty("ownReactions");
    });

    it("fails the read when the bot's identity cannot be told, instead of showing reactions it cannot sort", async () => {
      const slack = fakeSlack({
        getAgentNativeIdentity: vi
          .fn()
          .mockRejectedValue(new Error("No Slack bot token configured.")),
        getCompleteThread: vi.fn().mockResolvedValue({
          hasMore: false,
          messages: [message("1700000000.000100")],
        }),
      });

      await expect(
        readWorkflowSlackThread(asReader(slack), input),
      ).rejects.toMatchObject({ errorCode: "slack_not_connected" });
    });
  });

  it("keeps only messages after oldest, exclusive", async () => {
    const slack = fakeSlack({
      getCompleteThread: vi.fn().mockResolvedValue({
        hasMore: false,
        messages: [
          message("1700000000.000100"),
          message("1700000001.000100"),
          message("1700000002.000100"),
        ],
      }),
    });

    const result = await readWorkflowSlackThread(asReader(slack), {
      ...input,
      oldest: "1700000001.000100",
    });

    expect(result.messages.map((entry) => entry.ts)).toEqual([
      "1700000002.000100",
    ]);
    expect(result.messageCount).toBe(1);
  });

  it("is an error, never a short success, when the thread cannot be paged to the end", async () => {
    const stillMore = fakeSlack({
      getCompleteThread: vi
        .fn()
        .mockResolvedValue({ hasMore: true, messages: [message("1.1")] }),
    });
    const noCursor = fakeSlack({
      getCompleteThread: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Slack thread pagination is incomplete because the provider omitted its next cursor.",
          ),
        ),
    });

    for (const slack of [stillMore, noCursor]) {
      await expect(
        readWorkflowSlackThread(asReader(slack), input),
      ).rejects.toMatchObject({
        errorCode: "slack_thread_incomplete",
        sideEffect: "none",
      });
    }
  });

  it("says when it cut text or messages, and where to continue", async () => {
    const long = "x".repeat(SLACK_MESSAGE_TEXT_LIMIT + 50);
    const many = Array.from({ length: 40 }, (_, index) =>
      message(`1700000${String(index).padStart(3, "0")}.000100`, {
        text: "y".repeat(2_000),
      }),
    );
    const clipped = fakeSlack({
      getCompleteThread: vi.fn().mockResolvedValue({
        hasMore: false,
        messages: [message("1700000000.000100", { text: long })],
      }),
    });
    const crowded = fakeSlack({
      getCompleteThread: vi
        .fn()
        .mockResolvedValue({ hasMore: false, messages: many }),
    });

    const short = await readWorkflowSlackThread(asReader(clipped), input);
    const cut = await readWorkflowSlackThread(asReader(crowded), input);

    expect(short.truncated).toBe(true);
    expect(short.messages[0]).toMatchObject({ textTruncated: true });
    expect(short.messages[0]?.text).toHaveLength(SLACK_MESSAGE_TEXT_LIMIT);
    expect(cut.truncated).toBe(true);
    expect(cut.messageCount).toBe(40);
    expect(cut.omittedMessages).toBeGreaterThan(0);
    expect(cut.messages.length + cut.omittedMessages).toBe(40);
    expect(cut.nextOldest).toBe(cut.messages[cut.messages.length - 1]?.ts);
    expect(JSON.stringify(cut).length).toBeLessThan(40_000);
  });

  it("fails on an empty thread rather than reporting no replies", async () => {
    const slack = fakeSlack({
      getCompleteThread: vi
        .fn()
        .mockResolvedValue({ hasMore: false, messages: [] }),
    });

    await expect(
      readWorkflowSlackThread(asReader(slack), input),
    ).rejects.toMatchObject({ errorCode: "slack_not_found" });
  });

  it("names Slack's code and never its response body", async () => {
    const notFound = fakeSlack({
      getCompleteThread: vi
        .fn()
        .mockRejectedValue(new Error("Slack API error: thread_not_found")),
    });
    const server = fakeSlack({
      getCompleteThread: vi
        .fn()
        .mockRejectedValue(
          new Error("Slack API error 502: <html>token xoxb-secret</html>"),
        ),
    });
    const notConnected = fakeSlack({
      getCompleteThread: vi
        .fn()
        .mockRejectedValue(new Error("No Slack bot token configured.")),
    });

    await expect(
      readWorkflowSlackThread(asReader(notFound), input),
    ).rejects.toMatchObject({ errorCode: "slack_not_found" });
    const failure = await readWorkflowSlackThread(
      asReader(server),
      input,
    ).catch(
      (error: Error & { errorCode: string; retryable: boolean }) => error,
    );
    expect(failure).toMatchObject({
      errorCode: "slack_read_failed",
      retryable: true,
    });
    expect((failure as Error).message).not.toContain("xoxb");
    await expect(
      readWorkflowSlackThread(asReader(notConnected), input),
    ).rejects.toMatchObject({ errorCode: "slack_not_connected" });
  });

  it("keeps a saved token it cannot decrypt apart from a Slack failure and from not connected: it names the key and is not retryable", async () => {
    const unreadable = fakeSlack({
      getCompleteThread: vi
        .fn()
        .mockRejectedValue(new UnreadableSecretError("SLACK_BOT_TOKEN")),
    });

    const failure = await readWorkflowSlackThread(
      asReader(unreadable),
      input,
    ).catch(
      (error: Error & { errorCode: string; retryable: boolean }) => error,
    );

    expect(failure).toMatchObject({
      errorCode: "app_secret_unreadable",
      retryable: false,
      sideEffect: "none",
    });
    expect((failure as Error).message).toMatch(
      /SLACK_BOT_TOKEN is saved but this deployment cannot decrypt it/,
    );
  });
});

describe("classifySlackRecipient", () => {
  it("tells a channel, a person and an email apart", () => {
    expect(classifySlackRecipient("C0123ABCD", false)).toEqual({
      kind: "channel",
      id: "C0123ABCD",
    });
    expect(classifySlackRecipient("U0123ABCD", false)).toEqual({
      kind: "user",
      id: "U0123ABCD",
    });
    expect(classifySlackRecipient("ada@example.test", false)).toEqual({
      kind: "email",
      email: "ada@example.test",
    });
  });

  it("refuses a name, and refuses a person for a thread reply", () => {
    expect(() => classifySlackRecipient("#general", false)).toThrow(
      /not a Slack channel id/,
    );
    expect(() => classifySlackRecipient("U0123ABCD", true)).toThrow(
      /thread's channel id/,
    );
  });
});

describe("neutralizeSlackMentions", () => {
  it.each([
    ["<!channel>", "&lt;!channel>"],
    ["<!here>", "&lt;!here>"],
    ["<!everyone>", "&lt;!everyone>"],
    ["<!subteam^S0614TZR7>", "&lt;!subteam^S0614TZR7>"],
    ["<!subteam^S0614TZR7|@oncall>", "&lt;!subteam^S0614TZR7|@oncall>"],
    ["<!here|here>", "&lt;!here|here>"],
    ["<@U0123ABCD>", "&lt;@U0123ABCD>"],
    ["<@W0123ABCD|ada>", "&lt;@W0123ABCD|ada>"],
    ["<!date^1700000000^{date}|today>", "&lt;!date^1700000000^{date}|today>"],
  ])("escapes the ping %s so Slack shows it as typed", (ping, escaped) => {
    expect(neutralizeSlackMentions(`Customer wrote: ${ping} urgent`)).toBe(
      `Customer wrote: ${escaped} urgent`,
    );
  });

  it("escapes every ping, adjacent, repeated and hidden behind another bracket", () => {
    const out = neutralizeSlackMentions(
      "<!here><!channel> <<@U1> <@U2><@U3>\n<!everyone>",
    );
    expect(out).not.toMatch(/<[!@]/);
    expect(out).toBe(
      "&lt;!here>&lt;!channel> <&lt;@U1> &lt;@U2>&lt;@U3>\n&lt;!everyone>",
    );
  });

  it("keeps links, channel links, mailto links and plain text working", () => {
    const text =
      "See <https://example.test/a?b=1|the ticket>, <#C0123ABCD|bugs> and <mailto:a@example.test|Ada>. 1 < 2 and a <b> tag.";
    expect(neutralizeSlackMentions(text)).toBe(text);
  });
});

describe("postWorkflowSlackMessage", () => {
  const base = { workspace: "primary" as const, text: "Hello" };

  it("posts a ping in model-written text as plain text, in a channel and in a thread", async () => {
    const slack = fakeSlack({
      postChannelMessage: vi
        .fn()
        .mockResolvedValue({ channel: "C0123ABCD", ts: "1700000000.000200" }),
      postThreadReply: vi
        .fn()
        .mockResolvedValue({ channel: "C0123ABCD", ts: "1700000000.000300" }),
    });
    const text =
      "<!channel> <!subteam^S0614TZR7> <@U0123ABCD> see <https://example.test|it>";

    await postWorkflowSlackMessage(asReader(slack), {
      ...base,
      to: "C0123ABCD",
      text,
    });
    await postWorkflowSlackMessage(asReader(slack), {
      ...base,
      to: "C0123ABCD",
      threadTs: "1700000000.000100",
      text,
    });

    const sent =
      "&lt;!channel> &lt;!subteam^S0614TZR7> &lt;@U0123ABCD> see <https://example.test|it>";
    expect(slack.postChannelMessage).toHaveBeenCalledWith(
      "primary",
      "C0123ABCD",
      sent,
    );
    expect(slack.postThreadReply).toHaveBeenCalledWith(
      "primary",
      "C0123ABCD",
      "1700000000.000100",
      sent,
    );
  });

  it("posts the text as written when the node allows mentions", async () => {
    const slack = fakeSlack({
      postChannelMessage: vi
        .fn()
        .mockResolvedValue({ channel: "C0123ABCD", ts: "1700000000.000200" }),
    });

    await postWorkflowSlackMessage(asReader(slack), {
      ...base,
      to: "C0123ABCD",
      text: "<!here> deploy done",
      allowMentions: true,
    });

    expect(slack.postChannelMessage).toHaveBeenCalledWith(
      "primary",
      "C0123ABCD",
      "<!here> deploy done",
    );
  });

  it("refuses, with nothing posted, text that escaping pushes past the limit Slack cuts at", async () => {
    const slack = fakeSlack();

    await expect(
      postWorkflowSlackMessage(asReader(slack), {
        ...base,
        to: "C0123ABCD",
        text: "<!".repeat(SLACK_POST_TEXT_MAX / 2 - 100),
      }),
    ).rejects.toMatchObject({ errorCode: "slack_text_too_long" });
    expect(slack.postChannelMessage).not.toHaveBeenCalled();
  });

  it("posts to a channel and returns the ts and permalink", async () => {
    const slack = fakeSlack({
      postChannelMessage: vi
        .fn()
        .mockResolvedValue({ channel: "C0123ABCD", ts: "1700000000.000200" }),
    });

    const post = await postWorkflowSlackMessage(asReader(slack), {
      ...base,
      to: "C0123ABCD",
    });

    expect(post).toMatchObject({
      channel: "C0123ABCD",
      ts: "1700000000.000200",
      threadTs: null,
      permalink: "https://example.slack.com/archives/C0123ABCD/p1",
    });
    expect(slack.verifyAgentNativeIdentity).toHaveBeenCalledWith("primary");
    expect(slack.postChannelMessage).toHaveBeenCalledWith(
      "primary",
      "C0123ABCD",
      "Hello",
    );
  });

  it("replies in a thread", async () => {
    const slack = fakeSlack({
      postThreadReply: vi
        .fn()
        .mockResolvedValue({ channel: "C0123ABCD", ts: "1700000000.000300" }),
    });

    const post = await postWorkflowSlackMessage(asReader(slack), {
      ...base,
      to: "C0123ABCD",
      threadTs: "1700000000.000100",
    });

    expect(post.threadTs).toBe("1700000000.000100");
    expect(slack.postThreadReply).toHaveBeenCalledWith(
      "primary",
      "C0123ABCD",
      "1700000000.000100",
      "Hello",
    );
  });

  it("resolves an email to a Slack member before posting", async () => {
    const slack = fakeSlack({
      findUserByEmail: vi
        .fn()
        .mockResolvedValue({ id: "U0ADA", isBot: false, deleted: false }),
      postChannelMessage: vi
        .fn()
        .mockResolvedValue({ channel: "D0ADA", ts: "1700000000.000400" }),
    });

    const post = await postWorkflowSlackMessage(asReader(slack), {
      ...base,
      to: "ada@example.test",
    });

    expect(slack.postChannelMessage).toHaveBeenCalledWith(
      "primary",
      "U0ADA",
      "Hello",
    );
    expect(post.channel).toBe("D0ADA");
  });

  it("fails before writing when the email has no usable Slack member", async () => {
    const missing = fakeSlack({
      findUserByEmail: vi.fn().mockResolvedValue(null),
    });
    const deactivated = fakeSlack({
      findUserByEmail: vi
        .fn()
        .mockResolvedValue({ id: "U0ADA", isBot: false, deleted: true }),
    });

    await expect(
      postWorkflowSlackMessage(asReader(missing), {
        ...base,
        to: "x@example.test",
      }),
    ).rejects.toMatchObject({
      errorCode: "slack_user_not_found",
      sideEffect: "none",
    });
    await expect(
      postWorkflowSlackMessage(asReader(deactivated), {
        ...base,
        to: "x@example.test",
      }),
    ).rejects.toMatchObject({ errorCode: "slack_user_unreachable" });
    expect(missing.postChannelMessage).not.toHaveBeenCalled();
    expect(deactivated.postChannelMessage).not.toHaveBeenCalled();
  });

  it("fails before writing when the bot identity is wrong", async () => {
    const slack = fakeSlack({
      verifyAgentNativeIdentity: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Slack credential authenticated as @someone, not @agent-native.",
          ),
        ),
    });

    await expect(
      postWorkflowSlackMessage(asReader(slack), { ...base, to: "C0123ABCD" }),
    ).rejects.toMatchObject({
      errorCode: "slack_identity_mismatch",
      sideEffect: "none",
    });
    expect(slack.postChannelMessage).not.toHaveBeenCalled();
  });

  it("fails before writing, and not as a Slack failure, when the saved token cannot be decrypted", async () => {
    const slack = fakeSlack({
      verifyAgentNativeIdentity: vi
        .fn()
        .mockRejectedValue(new UnreadableSecretError("SLACK_BOT_TOKEN")),
    });

    await expect(
      postWorkflowSlackMessage(asReader(slack), { ...base, to: "C0123ABCD" }),
    ).rejects.toMatchObject({
      errorCode: "app_secret_unreadable",
      retryable: false,
      sideEffect: "none",
    });
    expect(slack.postChannelMessage).not.toHaveBeenCalled();
  });

  it("separates a message Slack rejected from one that may have been delivered", async () => {
    const rejected = fakeSlack({
      postChannelMessage: vi
        .fn()
        .mockRejectedValue(
          new SlackWriteError("Slack API error: channel_not_found", "rejected"),
        ),
    });
    const limited = fakeSlack({
      postChannelMessage: vi
        .fn()
        .mockRejectedValue(
          new SlackWriteError("Slack API error 429: slow down", "rejected", 30),
        ),
    });
    const dropped = fakeSlack({
      postChannelMessage: vi
        .fn()
        .mockRejectedValue(
          new SlackWriteError(
            "Slack transport error: socket hang up",
            "unknown",
          ),
        ),
    });
    const unreadable = fakeSlack({
      postChannelMessage: vi
        .fn()
        .mockRejectedValue(new SyntaxError("Unexpected end")),
    });

    await expect(
      postWorkflowSlackMessage(asReader(rejected), {
        ...base,
        to: "C0123ABCD",
      }),
    ).rejects.toMatchObject({
      errorCode: "slack_post_rejected",
      sideEffect: "none",
      details: { slackError: "channel_not_found" },
    });
    await expect(
      postWorkflowSlackMessage(asReader(limited), { ...base, to: "C0123ABCD" }),
    ).rejects.toMatchObject({
      errorCode: "slack_rate_limited",
      retryable: true,
      details: { retryAfterSeconds: 30 },
    });
    for (const slack of [dropped, unreadable]) {
      await expect(
        postWorkflowSlackMessage(asReader(slack), { ...base, to: "C0123ABCD" }),
      ).rejects.toMatchObject({
        errorCode: "slack_post_outcome_unknown",
        sideEffect: "maybe",
      });
    }
  });

  it("treats a reply with no message identity as a post that may have happened", async () => {
    const slack = fakeSlack({
      postChannelMessage: vi.fn().mockResolvedValue({ ok: true }),
    });

    await expect(
      postWorkflowSlackMessage(asReader(slack), { ...base, to: "C0123ABCD" }),
    ).rejects.toMatchObject({ errorCode: "slack_post_outcome_unknown" });
  });

  it("does not fail a message that was posted because its link could not be made", async () => {
    const slack = fakeSlack({
      postChannelMessage: vi
        .fn()
        .mockResolvedValue({ channel: "C0123ABCD", ts: "1700000000.000200" }),
      getMessagePermalink: vi
        .fn()
        .mockRejectedValue(new Error("Slack API error: message_not_found")),
    });

    const post = await postWorkflowSlackMessage(asReader(slack), {
      ...base,
      to: "C0123ABCD",
    });

    expect(post).toMatchObject({
      ts: "1700000000.000200",
      permalink: null,
      permalinkError: "message_not_found",
    });
  });
});

describe("readWorkflowSlackUserEmail", () => {
  const FALLBACK = "triage-owner@example.test";
  const found = (extra: Record<string, unknown> = {}) => ({
    id: "U01REPORT01",
    email: "ada@example.test",
    isBot: false,
    grantedScopes: ["users:read", "users:read.email"],
    ...extra,
  });
  const read = (
    slack: ReturnType<typeof fakeSlack>,
    input: { userId?: string; fallbackEmail?: string } = {},
  ) =>
    readWorkflowSlackUserEmail(asReader(slack), {
      workspace: "primary",
      userId: "U01REPORT01",
      fallbackEmail: FALLBACK,
      ...input,
    });
  const failure = (code: string, message?: string | RegExp) =>
    expect.objectContaining({
      errorCode: code,
      ...(message === undefined
        ? {}
        : { message: expect.stringMatching(message) }),
    });

  it("gives the address Slack has, and never the fallback, when the person has one", async () => {
    const slack = fakeSlack({
      getUserEmail: vi.fn().mockResolvedValue(found()),
    });

    await expect(read(slack)).resolves.toEqual({
      ok: true,
      userId: "U01REPORT01",
      email: "ada@example.test",
      emailSource: "slack",
    });
    expect(slack.getUserEmail).toHaveBeenCalledWith("primary", "U01REPORT01");
  });

  it("falls back, and says so, only when Slack looked, may see addresses, and found none", async () => {
    const slack = fakeSlack({
      getUserEmail: vi.fn().mockResolvedValue(found({ email: null })),
    });

    await expect(read(slack)).resolves.toEqual({
      ok: true,
      userId: "U01REPORT01",
      email: FALLBACK,
      emailSource: "fallback",
    });
  });

  it("refuses a person with no email when no usable fallback was given, instead of making one up", async () => {
    const slack = fakeSlack({
      getUserEmail: vi.fn().mockResolvedValue(found({ email: null })),
    });

    // `read` always supplies a fallback, so this calls the reader without the key to make the fallback absent.
    await expect(
      readWorkflowSlackUserEmail(asReader(slack), {
        workspace: "primary",
        userId: "U01REPORT01",
      }),
    ).rejects.toEqual(failure("slack_user_email_missing", /no email in Slack/));
    await expect(read(slack, { fallbackEmail: "  " })).rejects.toEqual(
      failure("slack_user_email_missing"),
    );
    await expect(
      read(slack, { fallbackEmail: "not-an-email" }),
    ).rejects.toEqual(failure("slack_user_email_missing", /not an address/));
  });

  it("reads a missing address as a missing scope, not as a person with none, when the token lacks users:read.email", async () => {
    const slack = fakeSlack({
      getUserEmail: vi
        .fn()
        .mockResolvedValue(
          found({ email: null, grantedScopes: ["users:read"] }),
        ),
    });

    await expect(read(slack)).rejects.toEqual(
      failure("slack_access_denied", /users:read\.email/),
    );
  });

  it("refuses when Slack sent no email and did not say what the token may see", async () => {
    const slack = fakeSlack({
      getUserEmail: vi
        .fn()
        .mockResolvedValue(found({ email: null, grantedScopes: null })),
    });

    await expect(read(slack)).rejects.toEqual(
      failure(
        "slack_user_email_unreadable",
        /did not list the credential's scopes/,
      ),
    );
  });

  it("refuses an email that is not an address", async () => {
    const slack = fakeSlack({
      getUserEmail: vi.fn().mockResolvedValue(found({ email: "not an email" })),
    });

    await expect(read(slack)).rejects.toEqual(
      failure("slack_user_email_unreadable"),
    );
  });

  it("refuses an author that is not a Slack user id before asking Slack", async () => {
    const slack = fakeSlack();

    for (const userId of ["ada@example.test", "Ada", "B0BOT", ""]) {
      await expect(read(slack, { userId })).rejects.toEqual(
        failure("slack_user_invalid"),
      );
    }
    expect(slack.getUserEmail).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an unknown id",
      new Error("Slack API error: user_not_found"),
      "slack_user_not_found",
      /no member/,
    ],
    [
      "a token without users:read",
      new Error("Slack API error: missing_scope"),
      "slack_access_denied",
      /users:read.*users:read\.email/,
    ],
    [
      "a revoked token",
      new Error("Slack API error: token_revoked"),
      "slack_access_denied",
      /token_revoked/,
    ],
    [
      "Slack down",
      new Error("Slack API error 503: unavailable"),
      "slack_lookup_failed",
      /HTTP 503/,
    ],
    [
      "a bot token that is not set",
      new Error("No Slack bot token configured. Connect Slack."),
      "slack_not_connected",
      /not connected/,
    ],
  ])(
    "fails with a typed error for %s, never the fallback",
    async (_name, error, code, message) => {
      const slack = fakeSlack({
        getUserEmail: vi.fn().mockRejectedValue(error),
      });

      await expect(read(slack)).rejects.toEqual(failure(code, message));
    },
  );

  it("passes an unreadable key through as itself", async () => {
    const unreadable = new UnreadableSecretError("SLACK_BOT_TOKEN");
    const slack = fakeSlack({
      getUserEmail: vi.fn().mockRejectedValue(unreadable),
    });

    await expect(read(slack)).rejects.toBe(unreadable);
  });
});
