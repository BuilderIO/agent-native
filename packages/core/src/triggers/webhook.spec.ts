import { describe, expect, it } from "vitest";

import {
  automationWebhookPath,
  createAutomationWebhookToken,
  isAutomationWebhookToken,
  webhookTokensMatch,
} from "./webhook.js";

describe("automation webhook credentials", () => {
  it("generates opaque tokens and compares them without exposing them", () => {
    const token = createAutomationWebhookToken();
    expect(token).toHaveLength(43);
    expect(isAutomationWebhookToken(token)).toBe(true);
    expect(webhookTokensMatch(token, token)).toBe(true);
    expect(webhookTokensMatch(token, `${token}x`)).toBe(false);
    expect(webhookTokensMatch(token, "not-a-token")).toBe(false);
    expect(automationWebhookPath(token)).toBe(
      `/_agent-native/automations/webhook/${token}`,
    );
  });
});
