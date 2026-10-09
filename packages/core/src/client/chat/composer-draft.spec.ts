// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import {
  assistantChatComposerDraftKey,
  clearAssistantChatComposerDraft,
  readAssistantChatComposerDraft,
  writeAssistantChatComposerDraft,
  readAssistantChatComposerContextDraft,
  readAssistantChatHiddenContext,
  writeAssistantChatComposerContextDraft,
  writeAssistantChatHiddenContext,
} from "./composer-draft.js";

describe("assistant chat composer drafts", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
        key: (index: number) => [...storage.keys()][index] ?? null,
        get length() {
          return storage.size;
        },
      },
    });
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
  it("stores bounded selection metadata without persisting context or unknown fields", () => {
    const selection = {
      designSystemId: "brand",
      references: [
        {
          source: "design" as const,
          id: "one",
          title: "Design",
          context: "Do not persist raw context",
          previewHtml: "<div>Do not persist previews</div>",
        },
      ],
    };
    writeAssistantChatComposerContextDraft(
      "design:account:org:thread",
      selection,
    );
    expect(
      readAssistantChatComposerContextDraft("design:account:org:thread"),
    ).toEqual({
      designSystemId: "brand",
      references: [{ source: "design", id: "one", title: "Design" }],
    });
    expect(
      readAssistantChatComposerContextDraft("design:other-account:org:thread"),
    ).toBeNull();
    expect(
      readAssistantChatComposerContextDraft("design:account:org:other-thread"),
    ).toBeNull();
    expect(
      [...Array(window.localStorage.length)]
        .map((_, index) =>
          window.localStorage.getItem(window.localStorage.key(index)!),
        )
        .join(""),
    ).not.toContain("Do not persist");
    writeAssistantChatComposerContextDraft("design:account:org:thread", {
      designSystemId: null,
      references: [],
    });
    expect(
      readAssistantChatComposerContextDraft("design:account:org:thread"),
    ).toBeNull();
  });
  it("distinguishes unreadable drafts from absent drafts and rejects oversized selections", () => {
    expect(() => readAssistantChatComposerContextDraft(" ")).toThrow();
    window.localStorage.setItem(
      "agent-chat-composer-context:broken",
      "{invalid",
    );
    expect(() => readAssistantChatComposerContextDraft("broken")).toThrow();
    expect(() =>
      writeAssistantChatComposerContextDraft("too-many", {
        designSystemId: null,
        references: Array.from({ length: 21 }, (_, index) => ({
          source: "slides" as const,
          id: String(index),
          title: "Deck",
        })),
      }),
    ).toThrow();
    expect(() =>
      writeAssistantChatComposerContextDraft("too-large", {
        designSystemId: null,
        references: Array.from({ length: 20 }, () => ({
          source: "website" as const,
          id: "a".repeat(2048),
          title: "b".repeat(2048),
          url: "https://example.com/".padEnd(2048, "c"),
        })),
      }),
    ).toThrow("size limit");
  });
});

describe("hidden composer context", () => {
  it("keeps hidden context per scope and removes it when cleared", () => {
    const item = {
      key: "prefill-context-1",
      title: "prefill-context-1",
      context: "Cast: Tom Holland, Sadie Sink",
    };
    writeAssistantChatHiddenContext("thread-a", [item]);

    expect(readAssistantChatHiddenContext("thread-a")).toEqual([
      { ...item, hidden: true },
    ]);
    expect(readAssistantChatHiddenContext("thread-b")).toEqual([]);

    writeAssistantChatHiddenContext("thread-a", []);
    expect(readAssistantChatHiddenContext("thread-a")).toEqual([]);
  });
});

describe("hidden composer context recovery", () => {
  it("discards an unreadable entry instead of failing the read", () => {
    const key = `agent-chat-composer-hidden-context:${encodeURIComponent("thread-c")}`;
    window.localStorage.setItem(key, "{not json");

    expect(readAssistantChatHiddenContext("thread-c")).toEqual([]);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("reads back a label longer than the old title cap", () => {
    const item = {
      key: "prefill-context-long",
      title: "x".repeat(3000),
      context: "Cast: Tom Holland",
    };
    writeAssistantChatHiddenContext("thread-d", [item]);

    expect(readAssistantChatHiddenContext("thread-d")).toEqual([
      { ...item, hidden: true },
    ]);
    writeAssistantChatHiddenContext("thread-d", []);
  });
});
