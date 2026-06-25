import crypto from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  buildChatUnfurlPayload,
  buildSlackVideoBlock,
  extractShareLink,
  postSlackUnfurl,
  slackUrlVerificationChallenge,
  validateSlackEventAllowlist,
  verifySlackSignature,
} from "./slack-unfurls";

function signedHeaders(rawBody: string, secret: string, timestamp = "12345") {
  return {
    timestamp,
    signature:
      "v0=" +
      crypto
        .createHmac("sha256", secret)
        .update(`v0:${timestamp}:${rawBody}`)
        .digest("hex"),
  };
}

function recording(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    title: "Launch walkthrough",
    description: "A product walkthrough",
    thumbnailUrl: "/api/media/thumb",
    animatedThumbnailUrl: null,
    visibility: "public",
    status: "ready",
    password: null,
    archivedAt: null,
    trashedAt: null,
    expiresAt: null,
    videoUrl: "https://media.example.com/rec-1.mp4",
    ...overrides,
  } as any;
}

describe("Clips Slack unfurls", () => {
  it("verifies Slack request signatures against the raw request body", () => {
    const rawBody = JSON.stringify({ type: "event_callback" });
    const secret = "example-signing-secret";
    const { timestamp, signature } = signedHeaders(rawBody, secret);

    expect(
      verifySlackSignature({
        rawBody,
        timestamp,
        signature,
        signingSecret: secret,
        nowMs: Number(timestamp) * 1000,
      }),
    ).toBe(true);
    expect(
      verifySlackSignature({
        rawBody,
        timestamp,
        signature: "v0=bad",
        signingSecret: secret,
        nowMs: Number(timestamp) * 1000,
      }),
    ).toBe(false);
  });

  it("extracts Slack URL verification challenges", () => {
    expect(
      slackUrlVerificationChallenge({
        type: "url_verification",
        challenge: "qa-challenge",
      }),
    ).toBe("qa-challenge");
  });

  it("parses Clips share links with optional app base paths", () => {
    expect(extractShareLink("https://clips.example.com/share/rec-1")).toEqual({
      id: "rec-1",
      origin: "https://clips.example.com",
      basePath: "",
    });
    expect(
      extractShareLink("https://apps.example.com/clips/share/rec-2"),
    ).toEqual({
      id: "rec-2",
      origin: "https://apps.example.com",
      basePath: "/clips",
    });
  });

  it("builds a Slack video block for ready public clips", () => {
    expect(
      buildSlackVideoBlock({
        recording: recording(),
        origin: "https://clips.example.com",
      }),
    ).toMatchObject({
      type: "video",
      title_url: "https://clips.example.com/share/rec-1",
      video_url: "https://clips.example.com/embed/rec-1?autoplay=1",
      thumbnail_url: "https://clips.example.com/api/media/thumb",
      provider_name: "Clips",
    });
  });

  it("does not build playable unfurls for password-protected clips", () => {
    expect(
      buildSlackVideoBlock({
        recording: recording({ password: "hashed-password" }),
        origin: "https://clips.example.com",
      }),
    ).toBeNull();
  });

  it("builds chat.unfurl payloads for link_shared events", async () => {
    const block = buildSlackVideoBlock({
      recording: recording(),
      origin: "https://clips.example.com",
    })!;

    await expect(
      buildChatUnfurlPayload(
        {
          type: "event_callback",
          event: {
            type: "link_shared",
            channel: "C123",
            message_ts: "1782136451.918049",
            links: [{ url: "https://clips.example.com/share/rec-1" }],
          },
        },
        async () => block,
      ),
    ).resolves.toEqual({
      channel: "C123",
      ts: "1782136451.918049",
      unfurls: {
        "https://clips.example.com/share/rec-1": { blocks: [block] },
      },
    });
  });

  it("requires a Slack team allowlist in production", () => {
    expect(
      validateSlackEventAllowlist(
        { type: "event_callback", team_id: "T123" },
        { NODE_ENV: "production" },
      ),
    ).toEqual({
      ok: false,
      status: 401,
      error: "Slack workspace allowlist is not configured",
    });
  });

  it("allows configured Slack teams and app ids", () => {
    expect(
      validateSlackEventAllowlist(
        { type: "event_callback", team_id: "T123", api_app_id: "A123" },
        {
          NODE_ENV: "production",
          SLACK_ALLOWED_TEAM_IDS: "T123, T456",
          SLACK_ALLOWED_API_APP_IDS: "A123",
        },
      ),
    ).toEqual({ ok: true });
  });

  it("rejects Slack events from unrecognized teams or app ids", () => {
    expect(
      validateSlackEventAllowlist(
        { type: "event_callback", team_id: "T999", api_app_id: "A123" },
        {
          NODE_ENV: "production",
          SLACK_ALLOWED_TEAM_IDS: "T123",
          SLACK_ALLOWED_API_APP_IDS: "A123",
        },
      ),
    ).toEqual({
      ok: false,
      status: 401,
      error: "Unrecognized Slack workspace",
    });

    expect(
      validateSlackEventAllowlist(
        { type: "event_callback", team_id: "T123", api_app_id: "A999" },
        {
          NODE_ENV: "production",
          SLACK_ALLOWED_TEAM_IDS: "T123",
          SLACK_ALLOWED_API_APP_IDS: "A123",
        },
      ),
    ).toEqual({
      ok: false,
      status: 401,
      error: "Unrecognized Slack app",
    });
  });

  it("posts chat.unfurl payloads to Slack", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const payload = {
      channel: "C123",
      ts: "1782136451.918049",
      unfurls: {},
    };

    await postSlackUnfurl({
      token: "example-bot-token",
      payload,
      fetchImpl: fetchImpl as any,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://slack.com/api/chat.unfurl",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  });
});
