import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({ getDb: () => ({}) }));
vi.mock("../lib/factory-automation-caller.js", () => ({
  readCallingFactoryAutomation: vi.fn(),
}));
vi.mock("../lib/factory-scope.js", () => ({ readTriageConfigRow: vi.fn() }));

import { addWorkflowSlackReaction } from "./slack-workflow.js";
import { SlackWriteError, addReaction } from "./slack.js";

type Reader = Parameters<typeof addWorkflowSlackReaction>[0];

function fakeSlack(overrides: Record<string, unknown> = {}) {
  return {
    verifyAgentNativeIdentity: vi.fn().mockResolvedValue(undefined),
    addReaction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
const asReader = (slack: ReturnType<typeof fakeSlack>) =>
  slack as unknown as Reader;

const message = {
  workspace: "primary" as const,
  channel: "C0123ABCD",
  ts: "1700000000.000100",
  name: "eyes",
};

/** What Slack says when it answers 200 and means no. */
const refusedBy = (code: string, retryAfter: number | null = null) =>
  new SlackWriteError(`Slack API error: ${code}`, "rejected", retryAfter);

describe("addWorkflowSlackReaction", () => {
  it("adds the reaction as the bot and returns a reference derived from the channel, message and emoji", async () => {
    const slack = fakeSlack();

    const result = await addWorkflowSlackReaction(asReader(slack), message);

    expect(slack.verifyAgentNativeIdentity).toHaveBeenCalledWith("primary");
    expect(slack.addReaction).toHaveBeenCalledWith(
      "primary",
      "C0123ABCD",
      "1700000000.000100",
      "eyes",
    );
    expect(result).toEqual({
      channel: "C0123ABCD",
      ts: "1700000000.000100",
      name: "eyes",
      alreadyReacted: false,
      externalRef: "C0123ABCD:1700000000.000100:eyes",
    });
  });

  it("takes :eyes: as eyes, and the other characters Slack names allow", async () => {
    const slack = fakeSlack();

    for (const name of [":eyes:", "white_check_mark", "+1", "-1", "a-b_c9"]) {
      await addWorkflowSlackReaction(asReader(slack), { ...message, name });
    }

    expect(slack.addReaction.mock.calls.map((call) => call[3])).toEqual([
      "eyes",
      "white_check_mark",
      "+1",
      "-1",
      "a-b_c9",
    ]);
  });

  it.each([
    ["an uppercase name", { name: "Eyes" }, "slack_reaction_invalid"],
    ["a name with a space", { name: "eyes now" }, "slack_reaction_invalid"],
    ["a name with colons inside", { name: "a:b" }, "slack_reaction_invalid"],
    ["an emoji character", { name: "👀" }, "slack_reaction_invalid"],
    ["an empty name", { name: "  " }, "slack_reaction_invalid"],
    [
      "a name over 50 characters",
      { name: "a".repeat(51) },
      "slack_reaction_invalid",
    ],
    ["a channel name", { channel: "#support" }, "slack_channel_invalid"],
    ["a person's id", { channel: "U0123ABCD" }, "slack_channel_invalid"],
    ["an email address", { channel: "a@b.co" }, "slack_channel_invalid"],
    [
      "a message time with letters",
      { ts: "yesterday" },
      "slack_timestamp_invalid",
    ],
    [
      "a message time with no fraction",
      { ts: "1700000000" },
      "slack_timestamp_invalid",
    ],
  ])("refuses %s before Slack is asked", async (_label, change, code) => {
    const slack = fakeSlack();

    await expect(
      addWorkflowSlackReaction(asReader(slack), { ...message, ...change }),
    ).rejects.toMatchObject({
      errorCode: code,
      sideEffect: "none",
      statusCode: 400,
    });
    expect(slack.verifyAgentNativeIdentity).not.toHaveBeenCalled();
    expect(slack.addReaction).not.toHaveBeenCalled();
  });

  it("treats Slack's already_reacted as the success it is, with a flag, and does not ask again", async () => {
    const slack = fakeSlack({
      addReaction: vi.fn().mockRejectedValue(refusedBy("already_reacted")),
    });

    const result = await addWorkflowSlackReaction(asReader(slack), message);

    expect(result).toMatchObject({
      alreadyReacted: true,
      externalRef: "C0123ABCD:1700000000.000100:eyes",
    });
    expect(slack.addReaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["channel_not_found", "slack_not_found"],
    ["message_not_found", "slack_not_found"],
    ["not_in_channel", "slack_not_found"],
    ["is_archived", "slack_not_found"],
    ["missing_scope", "slack_access_denied"],
    ["invalid_auth", "slack_access_denied"],
    ["token_revoked", "slack_access_denied"],
    ["invalid_name", "slack_reaction_rejected"],
    ["bad_timestamp", "slack_reaction_rejected"],
    ["not_reactable", "slack_reaction_rejected"],
    ["too_many_emoji", "slack_reaction_rejected"],
    ["thread_locked", "slack_reaction_rejected"],
    ["something_new", "slack_reaction_rejected"],
  ])(
    "reads Slack's 200 with ok:false and %s as %s, a failure that wrote nothing",
    async (slackCode, errorCode) => {
      const slack = fakeSlack({
        addReaction: vi.fn().mockRejectedValue(refusedBy(slackCode)),
      });

      await expect(
        addWorkflowSlackReaction(asReader(slack), message),
      ).rejects.toMatchObject({
        errorCode,
        sideEffect: "none",
        retryable: false,
        details: expect.objectContaining({ slackError: slackCode }),
      });
      expect(slack.addReaction).toHaveBeenCalledTimes(1);
    },
  );

  it("says what scope a missing_scope needs", async () => {
    const slack = fakeSlack({
      addReaction: vi.fn().mockRejectedValue(refusedBy("missing_scope")),
    });

    await expect(
      addWorkflowSlackReaction(asReader(slack), message),
    ).rejects.toThrow("reactions:write");
  });

  it("is a rate limit Slack rejected, safe to try again, by its code or its retry-after", async () => {
    for (const error of [refusedBy("ratelimited"), refusedBy("x", 30)]) {
      const slack = fakeSlack({
        addReaction: vi.fn().mockRejectedValue(error),
      });

      await expect(
        addWorkflowSlackReaction(asReader(slack), message),
      ).rejects.toMatchObject({
        errorCode: "slack_rate_limited",
        retryable: true,
        sideEffect: "none",
      });
    }
  });

  it("is slack_reaction_outcome_unknown when the request may have been delivered, and is never repeated", async () => {
    for (const error of [
      new SlackWriteError("Slack transport error: reset", "unknown"),
      new SlackWriteError("Slack API error 502: bad gateway", "unknown"),
      new Error("something nobody typed"),
    ]) {
      const slack = fakeSlack({
        addReaction: vi.fn().mockRejectedValue(error),
      });

      await expect(
        addWorkflowSlackReaction(asReader(slack), message),
      ).rejects.toMatchObject({
        errorCode: "slack_reaction_outcome_unknown",
        sideEffect: "maybe",
      });
      expect(slack.addReaction).toHaveBeenCalledTimes(1);
    }
  });

  it("fails before writing when Slack is not connected or the credential is not the app's bot", async () => {
    for (const [error, code] of [
      [new Error("No Slack bot token configured."), "slack_not_connected"],
      [
        new Error(
          "Slack credential authenticated as @someone, not @agent-native.",
        ),
        "slack_identity_mismatch",
      ],
    ] as const) {
      const slack = fakeSlack({
        verifyAgentNativeIdentity: vi.fn().mockRejectedValue(error),
      });

      await expect(
        addWorkflowSlackReaction(asReader(slack), message),
      ).rejects.toMatchObject({ errorCode: code, sideEffect: "none" });
      expect(slack.addReaction).not.toHaveBeenCalled();
    }
  });
});

describe("the connector's reactions.add", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const resolver = async () => "test-token";
  const slackAnswer = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });

  it("posts the channel, message and name as JSON to reactions.add with the resolved token", async () => {
    fetchMock.mockResolvedValue(slackAnswer({ ok: true }));

    await addReaction(
      "primary",
      "C0123ABCD",
      "1700000000.000100",
      "eyes",
      resolver,
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://slack.com/api/reactions.add");
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        channel: "C0123ABCD",
        timestamp: "1700000000.000100",
        name: "eyes",
      }),
      headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
    });
  });

  it("turns HTTP 200 with ok:false into a rejection that names Slack's code, so it is never read as success", async () => {
    fetchMock.mockResolvedValue(
      slackAnswer({ ok: false, error: "already_reacted" }),
    );

    await expect(
      addReaction(
        "primary",
        "C0123ABCD",
        "1700000000.000100",
        "eyes",
        resolver,
      ),
    ).rejects.toMatchObject({
      name: "SlackWriteError",
      delivery: "rejected",
      message: "Slack API error: already_reacted",
    });
  });

  it("is an unknown delivery after a 5xx or a dropped connection", async () => {
    fetchMock.mockResolvedValueOnce(slackAnswer({}, 503));
    await expect(
      addReaction("primary", "C1", "1.1", "eyes", resolver),
    ).rejects.toMatchObject({ delivery: "unknown" });

    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(
      addReaction("primary", "C1", "1.1", "eyes", resolver),
    ).rejects.toMatchObject({ delivery: "unknown" });
  });
});
