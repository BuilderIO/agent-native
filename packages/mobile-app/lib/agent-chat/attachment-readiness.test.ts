import { describe, expect, it } from "vitest";

import {
  canSendChatMessage,
  canUseChatAttachments,
} from "./attachment-readiness";

describe("mobile chat attachment readiness", () => {
  it("requires both a ready AI engine and configured file storage", () => {
    expect(canUseChatAttachments(true, "configured")).toBe(true);
    expect(canUseChatAttachments(true, "missing")).toBe(false);
    expect(canUseChatAttachments(true, "unavailable")).toBe(false);
    expect(canUseChatAttachments(false, "configured")).toBe(false);
  });

  it("keeps text chat available without storage but blocks staged attachments", () => {
    expect(canSendChatMessage(true, "missing", false)).toBe(true);
    expect(canSendChatMessage(true, "unavailable", false)).toBe(true);
    expect(canSendChatMessage(true, "missing", true)).toBe(false);
    expect(canSendChatMessage(true, "unknown", true)).toBe(false);
    expect(canSendChatMessage(true, "configured", true)).toBe(true);
  });
});
