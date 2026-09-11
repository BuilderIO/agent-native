// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import {
  assistantChatComposerDraftKey,
  clearAssistantChatComposerDraft,
  readAssistantChatComposerDraft,
  writeAssistantChatComposerDraft,
} from "./composer-draft.js";

describe("assistant chat composer drafts", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("names drafts by the chat scope without colliding on special characters", () => {
    expect(assistantChatComposerDraftKey("thread/a?b")).toBe(
      "agent-chat-composer-text:thread%2Fa%3Fb",
    );
    expect(assistantChatComposerDraftKey("  ")).toBeNull();
  });

  it("round-trips text synchronously so a remounted composer can recover it", () => {
    writeAssistantChatComposerDraft("analytics-thread", "keep this prompt");

    expect(readAssistantChatComposerDraft("analytics-thread")).toBe(
      "keep this prompt",
    );
  });

  it("removes the handoff value when the composer becomes empty or submits", () => {
    writeAssistantChatComposerDraft("analytics-thread", "keep this prompt");
    writeAssistantChatComposerDraft("analytics-thread", "   ");
    expect(readAssistantChatComposerDraft("analytics-thread")).toBeNull();

    writeAssistantChatComposerDraft("analytics-thread", "submitted");
    clearAssistantChatComposerDraft("analytics-thread");
    expect(readAssistantChatComposerDraft("analytics-thread")).toBeNull();
  });
});
