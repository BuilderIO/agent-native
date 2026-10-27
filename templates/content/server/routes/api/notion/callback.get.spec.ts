import crypto from "node:crypto";

import { mockEvent } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveNotionTokensForOwner = vi.fn();

vi.mock("../../../lib/notion.js", () => ({
  NOTION_OAUTH_STATE_COOKIE: "notion_oauth_state",
  exchangeNotionCodeForTokens: vi.fn(async () => ({ access_token: "notion" })),
  getDocumentOwnerEmail: vi.fn(async () => "owner@example.test"),
  saveNotionTokensForOwner,
}));

const SECRET = "notion-state-secret-for-tests";
const NONCE = "nonce-1";

function callbackUrl(redirectPath: string): string {
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(`redirectPath:${redirectPath}`)
    .digest("base64url");
  const state = Buffer.from(
    JSON.stringify({ redirectPath, sig, n: NONCE }),
  ).toString("base64url");
  return `http://localhost/api/notion/callback?code=spent-code&state=${state}`;
}

describe("Notion OAuth callback", () => {
  beforeEach(() => {
    vi.stubEnv("NOTION_STATE_SECRET", SECRET);
    saveNotionTokensForOwner.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lands the browser on its page without the spent code and state", async () => {
    const { default: handler } = await import("./callback.get.js");
    const event = mockEvent(callbackUrl("/page/doc_1"), {
      headers: {
        cookie: `notion_oauth_state=${NONCE}`,
        "sec-fetch-mode": "navigate",
      },
    });

    const response = (await handler(event)) as Response;
    const html = await response.text();

    expect(saveNotionTokensForOwner).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(html).toContain('content="0;url=/page/doc_1"');
    expect(html).not.toContain("spent-code");
  });
});
