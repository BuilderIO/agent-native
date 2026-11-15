import { mockEvent } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storeSlackHuddleEvent: vi.fn(),
  fillMeetingsForHuddle: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  platformWaitUntil: () => mocks.waitUntil,
}));

vi.mock("../../../lib/slack-huddle-oauth.js", () => ({
  slackHuddleDeps: () => ({}),
}));

vi.mock("../../../lib/slack-huddles-store.js", () => ({
  storeSlackHuddleEvent: (...args: unknown[]) =>
    mocks.storeSlackHuddleEvent(...args),
  fillMeetingsForHuddle: (...args: unknown[]) =>
    mocks.fillMeetingsForHuddle(...args),
}));

vi.mock("../../../lib/slack-oauth.js", () => ({
  readSlackBotTokenForPayload: vi.fn(),
}));

vi.mock("../../../lib/slack-unfurls.js", () => ({
  handleSlackLinkSharedPayload: vi.fn(),
  parseSlackJsonPayload: (raw: string) => JSON.parse(raw),
  slackUrlVerificationChallenge: () => null,
  validateSlackEventAllowlist: () => ({ ok: true }),
  verifySlackSignature: () => true,
}));

import handler from "./unfurl.post";

const huddleMessage = {
  type: "event_callback",
  team_id: "T0TEAM",
  event: { type: "message", subtype: "huddle_thread", channel: "C1" },
};

function slackEvent() {
  return mockEvent("https://clips.example.test/api/slack/unfurl", {
    method: "POST",
    body: JSON.stringify(huddleMessage),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SLACK_SIGNING_SECRET = "secret";
});

describe("Slack huddle events", () => {
  it("acknowledges once the huddle is stored, without waiting for the profile fill", async () => {
    const huddle = { teamId: "T0TEAM" };
    mocks.storeSlackHuddleEvent.mockResolvedValue(huddle);
    // A fill that never finishes must not hold the acknowledgment.
    mocks.fillMeetingsForHuddle.mockReturnValue(new Promise(() => {}));
    const event = slackEvent();

    await expect(
      (handler as (e: unknown) => Promise<unknown>)(event),
    ).resolves.toEqual({ ok: true });
    expect(mocks.fillMeetingsForHuddle).toHaveBeenCalledWith({}, huddle);
    expect(mocks.waitUntil).toHaveBeenCalledTimes(1);
  });

  it("does not fill a message that is not a stored huddle", async () => {
    mocks.storeSlackHuddleEvent.mockResolvedValue(null);
    await expect(
      (handler as (e: unknown) => Promise<unknown>)(slackEvent()),
    ).resolves.toEqual({ ok: true });
    expect(mocks.fillMeetingsForHuddle).not.toHaveBeenCalled();
  });

  it("answers 500 when the huddle cannot be stored, so Slack retries", async () => {
    mocks.storeSlackHuddleEvent.mockRejectedValue(new Error("db down"));
    const event = slackEvent();
    await expect(
      (handler as (e: unknown) => Promise<unknown>)(event),
    ).resolves.toMatchObject({ ok: false });
    expect(event.res.status).toBe(500);
    expect(mocks.fillMeetingsForHuddle).not.toHaveBeenCalled();
  });

  it("logs a failed background fill instead of rejecting", async () => {
    mocks.storeSlackHuddleEvent.mockResolvedValue({ teamId: "T0TEAM" });
    mocks.fillMeetingsForHuddle.mockRejectedValue(new Error("slack down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await (handler as (e: unknown) => Promise<unknown>)(slackEvent());
    await expect(mocks.waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
