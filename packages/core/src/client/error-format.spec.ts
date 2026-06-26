import { describe, expect, it } from "vitest";

import {
  BUILDER_SPACE_SETTINGS_URL,
  NEW_CHAT_ACTION_HREF,
  formatChatErrorText,
  normalizeChatError,
} from "./error-format.js";

describe("formatChatErrorText", () => {
  it("adds a Builder space settings CTA for disabled gateway errors", () => {
    expect(
      formatChatErrorText(
        "This space has not enabled the LLM gateway. A space admin can enable it in Account settings.",
        undefined,
        "gateway_not_enabled",
      ),
    ).toBe(
      `Error: This space has not enabled the LLM gateway. A space admin can enable it in Account settings.\n\n[Open Builder space settings](${BUILDER_SPACE_SETTINGS_URL})`,
    );
  });

  it("adds the settings CTA when the code is missing but the message matches", () => {
    expect(
      formatChatErrorText(
        "This space has not enabled the LLM gateway. A space admin can enable it in Account settings.",
      ),
    ).toContain(`[Open Builder space settings](${BUILDER_SPACE_SETTINGS_URL})`);
  });

  it("keeps quota errors on the billing CTA", () => {
    expect(
      formatChatErrorText(
        "Monthly credits limit reached.",
        "https://builder.io/account/billing",
        "credits-limit-monthly",
      ),
    ).toBe(
      "Error: Monthly credits limit reached.\n\n[Upgrade at builder.io](https://builder.io/account/billing)",
    );
  });

  it("adds a Start-new-chat CTA for no-detail builder gateway errors", () => {
    const text = formatChatErrorText(
      'Gateway error (no detail; raw event: {"type":"stop","reason":"error","requestId":"req_1"})',
      undefined,
      "builder_gateway_error",
    );
    expect(text).toContain(`[Start new chat](${NEW_CHAT_ACTION_HREF})`);
    expect(text).toMatch(/^Error: /);
    // The CTA is the only suffix — no Upgrade-at-Builder CTA on this error
    // code, since it's not a quota/billing problem.
    expect(text).not.toContain("[Upgrade at builder.io]");
  });

  it("adds a Start-new-chat CTA for context_length_exceeded errors", () => {
    const text = formatChatErrorText(
      "Conversation has grown too long. The agent tried to recover automatically but the context is still too large. You can continue in a new chat, or ask the agent to summarize the conversation and continue.",
      undefined,
      "context_length_exceeded",
    );
    expect(text).toContain(`[Start new chat](${NEW_CHAT_ACTION_HREF})`);
    expect(text).toMatch(/^Error: /);
    expect(text).not.toContain("[Upgrade at builder.io]");
  });

  it("adds a Start-new-chat CTA for input_too_long errors", () => {
    const text = formatChatErrorText(
      "Input is too long.",
      undefined,
      "input_too_long",
    );
    expect(text).toContain(`[Start new chat](${NEW_CHAT_ACTION_HREF})`);
  });

  it("keeps raw gateway events out of the primary user-facing message", () => {
    const normalized = normalizeChatError(
      'Gateway error (no detail; raw event: {"type":"stop","reason":"error","requestId":"req_1"})',
    );
    expect(normalized.details).toBe(
      'Gateway error (no detail; raw event: {"type":"stop","reason":"error","requestId":"req_1"})',
    );
    // Copy must not promise auto-recovery or suggest switching models — the
    // server already retried once and the client skips auto-continuation
    // for this code, and the error is almost always upstream so a different
    // model lands on the same wall.
    expect(normalized.message).not.toMatch(/recover automatically/i);
    expect(normalized.message).not.toMatch(/another model/i);
    expect(normalized.message).toMatch(/gateway/i);
    expect(normalized.message).toMatch(/new chat|retry|wait/i);
  });

  it("normalizes provider rate limits without exposing raw status-only text", () => {
    const normalized = normalizeChatError(
      "429 status code (no body)",
      "provider_rate_limited",
    );
    expect(normalized.message).toBe(
      "The model provider is rate-limiting this chat right now. Wait a moment, then retry.",
    );
    expect(normalized.details).toBe("429 status code (no body)");
    expect(normalized.message).not.toContain("no body");
  });

  it("formats provider rate limits as a plain retryable user message", () => {
    expect(
      formatChatErrorText(
        "429 status code (no body)",
        undefined,
        "provider_rate_limited",
      ),
    ).toBe(
      "Error: The model provider is rate-limiting this chat right now. Wait a moment, then retry.",
    );
  });
});
