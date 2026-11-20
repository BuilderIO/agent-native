import { describe, expect, it } from "vitest";

import { GATEWAY_UNAVAILABLE_VISITOR_MESSAGE } from "../agent/engine/credential-errors.js";
import {
  localizeKnownChatErrorText,
  normalizeChatError,
} from "./error-format.js";

describe("email verification errors", () => {
  const translate = (key: string) => `localized:${key}`;

  it("localizes the normalized workspace verification message", () => {
    const normalized = normalizeChatError(
      "At least one user in this space must verify their email before using AI.",
      "email_verification_required",
    );

    expect(localizeKnownChatErrorText(normalized.message, translate)).toBe(
      "localized:agentChat.errorMessages.emailVerificationRequired",
    );
  });

  it("preserves the generic server-chosen message for visitors", () => {
    const normalized = normalizeChatError(
      GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
      "email_verification_required",
    );

    expect(normalized).toStrictEqual({
      message: GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
    });
    expect(localizeKnownChatErrorText(normalized.message, translate)).toBe(
      GATEWAY_UNAVAILABLE_VISITOR_MESSAGE,
    );
  });
});
