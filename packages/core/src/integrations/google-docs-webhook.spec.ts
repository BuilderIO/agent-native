import { describe, expect, it } from "vitest";

import {
  createGoogleDocsChannelAuth,
  verifyGoogleDocsChannel,
} from "./google-docs-webhook.js";

describe("Google Docs Drive channel authentication", () => {
  it("accepts the matching channel and rejects mismatches", () => {
    const auth = createGoogleDocsChannelAuth();
    const expected = {
      channelId: "channel-1",
      channelTokenHash: auth.tokenHash,
      resourceId: "resource-1",
    };

    expect(
      verifyGoogleDocsChannel(expected, {
        channelId: "channel-1",
        channelToken: auth.token,
        resourceId: "resource-1",
      }),
    ).toBe(true);
    expect(
      verifyGoogleDocsChannel(expected, {
        channelId: "channel-1",
        channelToken: "wrong-token",
        resourceId: "resource-1",
      }),
    ).toBe(false);
    expect(
      verifyGoogleDocsChannel(expected, {
        channelId: "channel-2",
        channelToken: auth.token,
        resourceId: "resource-1",
      }),
    ).toBe(false);
    expect(
      verifyGoogleDocsChannel(expected, {
        channelId: "channel-1",
        channelToken: auth.token,
        resourceId: "resource-2",
      }),
    ).toBe(false);
  });
});
