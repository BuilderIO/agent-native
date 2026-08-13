import { describe, expect, it } from "vitest";

import { GATEWAY_UNAVAILABLE_VISITOR_MESSAGE } from "../agent/engine/credential-errors.js";
import {
  BUILDER_SPACE_SETTINGS_URL,
  NEW_CHAT_ACTION_HREF,
  formatChatErrorText,
  normalizeChatError,
} from "./error-format.js";

describe("formatChatErrorText", () => {
  const agentNativeUpgradeUrl =
    "https://builder.io/account/subscription?signupSource=agent-native&agentNativeConnectSource=gateway_quota_upgrade&agentNativeFlow=connect_llm&framework=agent-native&utm_source=agent-native&utm_medium=product&utm_campaign=onboarding&utm_content=gateway_quota_upgrade";

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
        agentNativeUpgradeUrl,
        "credits-limit-monthly",
      ),
    ).toBe(
      `Error: Monthly credits limit reached.\n\n[Upgrade at builder.io](${agentNativeUpgradeUrl})`,
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

  it("normalizes the gateway's email-verification block into something actionable", () => {
    // Arrives as a bare gateway 403 with no upgradeUrl, so with no case here
    // it fell through to the raw upstream sentence under a generic "The agent
    // hit an error" headline with no retry — a dead end, and in production the
    // largest single cause of chat turns ending without an answer.
    const raw =
      "At least one user in this space must verify their email before using AI.";
    const normalized = normalizeChatError(raw, "email_verification_required");

    expect(normalized.message).toBe(
      "AI is paused until an email address in this workspace is verified. Check the inbox for the verification link, then retry.",
    );
    expect(normalized.details).toBe(raw);
  });

  // The engine keeps the real reason on `errorCode` so the site owner can
  // diagnose it, and this is the layer that turns a code back into copy. Every
  // code below has a mapping here or in `formatChatErrorText`, so without the
  // guard the render boundary undoes the server's rewrite and the visitor reads
  // the owner instruction again — the guarantee has to hold HERE, not only at
  // the engine that chose the message.
  describe("a message the server already chose for a visitor", () => {
    const ownerCodes = [
      "builder_auth_error",
      "builder_model_unauthorized",
      "email_verification_required",
      "provider_config_error",
      "credits-limit-reached",
      "rate_limit_exceeded",
      "gateway_not_enabled",
      "too_many_concurrent_requests",
      "http_403",
      "invalid_request",
      "builder_gateway_stream_ended",
      "missing_credentials",
    ];

    for (const errorCode of ownerCodes) {
      it(`survives ${errorCode} unchanged`, () => {
        const normalized = normalizeChatError(
          GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
          errorCode,
        );
        expect(normalized).toStrictEqual({
          message: GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
        });
        // No owner CTA either: a link to Builder space settings is an action
        // only the owner of an org the visitor is not in can take.
        expect(
          formatChatErrorText(
            GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
            undefined,
            errorCode,
          ),
        ).toBe(`Error: ${GATEWAY_UNAVAILABLE_VISITOR_MESSAGE}`);
      });
    }

    it("still maps the same codes for an owner-facing message", () => {
      expect(
        normalizeChatError("Invalid token", "builder_auth_error").message,
      ).toBe(
        "Builder rejected the connected credentials. Reconnect Builder.io (free tier available) in Settings, then retry.",
      );
      expect(
        formatChatErrorText(
          "This space has not enabled the LLM gateway.",
          undefined,
          "gateway_not_enabled",
        ),
      ).toContain(BUILDER_SPACE_SETTINGS_URL);
    });
  });

  it("normalizes provider API key authentication failures", () => {
    const raw =
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_example"}';
    const normalized = normalizeChatError(raw, "authentication_error");

    expect(normalized.message).toBe(
      "The saved provider key was rejected. Connect Builder.io for managed AI, or update your provider key, then retry.",
    );
    expect(normalized.details).toBe(raw);
    expect(formatChatErrorText(raw, undefined, "authentication_error")).toBe(
      "Error: The saved provider key was rejected. Connect Builder.io for managed AI, or update your provider key, then retry.",
    );
  });

  it("normalizes bare provider 401 failures without exposing no-body status text", () => {
    const normalized = normalizeChatError("401 status code (no body)");

    expect(normalized.message).toBe(
      "The saved provider key was rejected. Connect Builder.io for managed AI, or update your provider key, then retry.",
    );
    expect(normalized.details).toBe("401 status code (no body)");
    expect(normalized.message).not.toContain("no body");
    expect(formatChatErrorText("401 status code (no body)")).toBe(
      "Error: The saved provider key was rejected. Connect Builder.io for managed AI, or update your provider key, then retry.",
    );
  });

  it("normalizes the stored credential failure marker without an error code", () => {
    expect(
      normalizeChatError("The model provider rejected the saved API key."),
    ).toMatchObject({
      message:
        "The saved provider key was rejected. Connect Builder.io for managed AI, or update your provider key, then retry.",
    });
  });

  it("normalizes provider network failures into an actionable retry message", () => {
    const normalized = normalizeChatError(
      "provider_network_error",
      "provider_network_error",
    );

    expect(normalized.message).toBe(
      "The model provider could not be reached. Check your connection and retry.",
    );
    expect(normalized.details).toBe("provider_network_error");
  });

  it("normalizes generic connection failures into an actionable retry message", () => {
    const normalized = normalizeChatError(
      "connection_error",
      "connection_error",
    );

    expect(normalized.message).toBe(
      "The agent connection was interrupted. Check your connection and retry.",
    );
    expect(normalized.details).toBe("connection_error");
  });
});
