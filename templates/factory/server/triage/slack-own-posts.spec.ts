import { describe, expect, it } from "vitest";

import type { SlackMessage } from "../connectors/slack.js";
import { UnreadableSecretError } from "../lib/unreadable-secret.js";
import {
  ownPostMatcher,
  resolveOwnSlackIdentity,
  SLACK_IDENTITY_UNRESOLVED_CODE,
  SlackIdentityUnresolvedError,
} from "./slack-own-posts.js";

const OWN = { userId: "UAPP0000001", botId: "BAPP0000001" };
const APP_ID = "AAPP0000001";

const post = (ts: string, extra: Partial<SlackMessage> = {}): SlackMessage => ({
  type: "message",
  text: `post ${ts}`,
  ts,
  ...extra,
});

describe("ownPostMatcher", () => {
  it("knows a post by the app's bot user, its bot, or its Slack app, whichever Slack left on it", () => {
    const byUser = post("1.1", { user: OWN.userId });
    const byBot = post("1.2", { bot_id: OWN.botId, username: "agent-native" });
    const byProfile = post("1.3", { bot_profile: { id: OWN.botId } });
    const byProfileUser = post("1.4", { bot_profile: { user_id: OWN.userId } });
    // Names nothing but the app: known only because a sibling post named both.
    const byApp = post("1.5", { app_id: APP_ID });
    const sibling = post("1.6", {
      user: OWN.userId,
      bot_id: OWN.botId,
      app_id: APP_ID,
    });
    const messages = [byUser, byBot, byProfile, byProfileUser, byApp, sibling];

    const isOwn = ownPostMatcher(messages, OWN);

    expect(messages.map(isOwn)).toEqual([true, true, true, true, true, true]);
  });

  it("does not know a person, or another app's bot, even beside the app's own post", () => {
    const person = post("2.1", { user: "UPERSON" });
    const otherApp = post("2.2", {
      subtype: "bot_message",
      bot_id: "BOTHER00001",
      app_id: "AOTHER00001",
      user: "UOTHERBOT01",
      bot_profile: { id: "BOTHER00001", app_id: "AOTHER00001" },
    });
    const own = post("2.3", {
      bot_id: OWN.botId,
      app_id: APP_ID,
      user: OWN.userId,
    });

    const isOwn = ownPostMatcher([person, otherApp, own], OWN);

    expect([person, otherApp, own].map(isOwn)).toEqual([false, false, true]);
  });

  it("finds the author of an edit or a delete inside the event, where Slack puts it", () => {
    const edited = post("3.1", {
      subtype: "message_changed",
      message: post("3.0", { user: OWN.userId }),
      previous_message: post("3.0", { user: OWN.userId }),
    });
    const deleted = post("3.2", {
      subtype: "message_deleted",
      previous_message: post("3.0", { bot_id: OWN.botId }),
    });
    const personsEdit = post("3.3", {
      subtype: "message_changed",
      message: post("3.0", { user: "UPERSON" }),
    });

    const isOwn = ownPostMatcher([edited, deleted, personsEdit], OWN);

    expect([edited, deleted, personsEdit].map(isOwn)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("matches a user token's identity when there is no bot, and never takes a missing bot id for the app's", () => {
    const own = { userId: "UAPP0000001" };
    const mine = post("4.1", { user: own.userId });
    // A post with no bot id at all must not match an app that has none either.
    const anonymous = post("4.2", { user: "UPERSON" });

    const isOwn = ownPostMatcher([mine, anonymous], own);

    expect([mine, anonymous].map(isOwn)).toEqual([true, false]);
  });

  it("does not learn another app's id from the posts it reads", () => {
    const other = post("5.1", { user: "UOTHERBOT01", app_id: "AOTHER00001" });
    const sameAppAsOther = post("5.2", { app_id: "AOTHER00001" });

    const isOwn = ownPostMatcher([other, sameAppAsOther], OWN);

    expect([other, sameAppAsOther].map(isOwn)).toEqual([false, false]);
  });
});

describe("resolveOwnSlackIdentity", () => {
  it("returns the user and the bot the reader already verified", async () => {
    const identity = await resolveOwnSlackIdentity(
      {
        getAgentNativeIdentity: async () => ({
          userId: OWN.userId,
          userName: "agent-native",
          teamId: "T1",
          teamName: "Team",
          botId: OWN.botId,
        }),
      },
      "primary",
    );

    expect(identity).toEqual(OWN);
  });

  it("returns a user alone for a token that has no bot", async () => {
    const identity = await resolveOwnSlackIdentity(
      {
        getAgentNativeIdentity: async () => ({
          userId: OWN.userId,
          userName: "agent-native",
          teamId: "T1",
          teamName: "Team",
        }),
      },
      "primary",
    );

    expect(identity).toEqual({ userId: OWN.userId });
  });

  it("fails with a typed error when Slack will not say who the app is", async () => {
    const lookup = resolveOwnSlackIdentity(
      {
        getAgentNativeIdentity: async () => {
          throw new Error("Slack API error: invalid_auth");
        },
      },
      "primary",
    );

    await expect(lookup).rejects.toBeInstanceOf(SlackIdentityUnresolvedError);
    await expect(lookup).rejects.toMatchObject({
      errorCode: SLACK_IDENTITY_UNRESOLVED_CODE,
      retryable: true,
    });
    await expect(lookup).rejects.toThrow(/invalid_auth/);
  });

  it("fails the same way when the answer has no user id, rather than matching nothing", async () => {
    const lookup = resolveOwnSlackIdentity(
      {
        getAgentNativeIdentity: async () => ({
          userId: "",
          userName: "agent-native",
          teamId: "T1",
          teamName: "Team",
        }),
      },
      "primary",
    );

    await expect(lookup).rejects.toMatchObject({
      errorCode: SLACK_IDENTITY_UNRESOLVED_CODE,
    });
  });

  it("leaves a saved key that cannot be decrypted with its own code", async () => {
    const unreadable = new UnreadableSecretError("SLACK_BOT_TOKEN");

    const lookup = resolveOwnSlackIdentity(
      {
        getAgentNativeIdentity: async () => {
          throw unreadable;
        },
      },
      "primary",
    );

    await expect(lookup).rejects.toBe(unreadable);
  });
});
