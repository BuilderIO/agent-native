import { describe, expect, it } from "vitest";

import { formatChatErrorText, normalizeChatError } from "./error-format.js";

describe("normalizeChatError for password-protected PDF attachments", () => {
  const CLEAN_MESSAGE =
    "This PDF is password-protected, so it can't be read. Remove the password protection or paste the relevant text, then retry.";

  it("translates the already-unwrapped gateway message into an actionable one", () => {
    const raw =
      "messages.0.content.0.pdf.source.base64.data: The PDF specified is password protected.";
    const normalized = normalizeChatError(raw, "invalid_request_error");

    expect(normalized.message).toBe(CLEAN_MESSAGE);
    expect(normalized.details).toBe(raw);
    expect(formatChatErrorText(raw, undefined, "invalid_request_error")).toBe(
      `Error: ${CLEAN_MESSAGE}`,
    );
  });

  it("translates the raw provider envelope reported in the Mail bug", () => {
    const raw =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.0.content.0.pdf.source.base64.data: The PDF specified is password protected."},"request_id":"req_011Cf4z4ndjZtcUm5pPTkjPA"}';
    const normalized = normalizeChatError(raw);

    expect(normalized.message).toBe(CLEAN_MESSAGE);
  });

  it("does not misclassify an unrelated invalid_request_error as a password-protected attachment", () => {
    const raw = "model is required";
    const normalized = normalizeChatError(raw, "invalid_request_error");

    expect(normalized.message).not.toBe(CLEAN_MESSAGE);
    expect(normalized.details).toBe(raw);
  });
});
