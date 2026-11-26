// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import {
  assistantChatComposerDraftKey,
  clearAssistantChatComposerDraft,
  readAssistantChatComposerDraft,
  writeAssistantChatComposerDraft,
  readAssistantChatComposerContextDraft,
  writeAssistantChatComposerContextDraft,
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
        _map: storage,
        get length() {
          return storage.size;
        },
      },
    });
  });

  it("does not hand a draft written by another browser session to a fresh panel", () => {
    // a previous run's prompt appeared in a new tab of the same
    // signed-in profile. A draft belongs to the tab session that wrote it.
    window.localStorage.setItem(
      assistantChatComposerDraftKey("stale-thread")!,
      "Earlier session draft - not sent",
    );
    expect(readAssistantChatComposerDraft("stale-thread")).toBeNull();

    // Typing here marks this session, so its own reload can recover the text.
    writeAssistantChatComposerDraft("my-thread", "Typed in this tab");
    expect(readAssistantChatComposerDraft("my-thread")).toBe(
      "Typed in this tab",
    );

    // A new session (sessionStorage cleared) starts empty.
    window.sessionStorage.clear();
    expect(readAssistantChatComposerDraft("my-thread")).toBeNull();
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
  it.each([
    "design",
    "slides",
    "figma",
    "website",
    "integration",
    "google-slides",
    "app.custom:reference",
    "x".repeat(128),
  ])(
    "round-trips app-owned source metadata %s without interpreting it",
    (source) => {
      const selection = {
        designSystemId: null,
        references: [{ source, id: "resource-one", title: "Reference" }],
      };
      writeAssistantChatComposerContextDraft(
        "app:account:org:thread",
        selection,
      );
      expect(
        readAssistantChatComposerContextDraft("app:account:org:thread"),
      ).toEqual(selection);
    },
  );
  it.each([
    "",
    "x".repeat(129),
    "google slides",
    "https://example.test",
    "app/source",
    " source",
    "source\n",
    "app..source",
  ])("rejects malformed source metadata %j on write and read", (source) => {
    const selection = {
      designSystemId: null,
      references: [{ source, id: "resource-one", title: "Reference" }],
    };
    expect(() =>
      writeAssistantChatComposerContextDraft("invalid-source", selection),
    ).toThrow();
    expect(readAssistantChatComposerContextDraft("invalid-source")).toBeNull();
    const invalidKey = "agent-chat-composer-context:invalid-source";
    window.localStorage.setItem(
      invalidKey,
      JSON.stringify({ version: 1, selection }),
    );
    // Owned by this tab session, so the malformed draft is read and refused.
    window.sessionStorage.setItem(
      `agent-chat-composer-session:${invalidKey}`,
      "1",
    );
    expect(() =>
      readAssistantChatComposerContextDraft("invalid-source"),
    ).toThrow();
  });
  it("distinguishes unreadable drafts from absent drafts and rejects oversized selections", () => {
    expect(() => readAssistantChatComposerContextDraft(" ")).toThrow();
    // A draft this tab session owns: an unreadable one must still throw rather
    // than read as absent (the session boundary was added for this; a draft from
    // an earlier session is simply not read, which is the separate test above).
    const brokenKey = "agent-chat-composer-context:broken";
    window.localStorage.setItem(brokenKey, "{invalid");
    window.sessionStorage.setItem(
      `agent-chat-composer-session:${brokenKey}`,
      "1",
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
