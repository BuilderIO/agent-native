// @vitest-environment happy-dom

import { COMPOSER_CONTEXT_MAX_ITEMS } from "@agent-native/toolkit/composer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearFailedChatHandoff,
  initialComposerOptionsFromState,
  readFailedChatHandoff,
  writeFailedChatHandoff,
} from "./chat-paths";

describe("initial Chat composer options", () => {
  it("distinguishes absent, valid, and invalid route state", () => {
    expect(initialComposerOptionsFromState(null)).toEqual({
      status: "absent",
    });
    expect(
      initialComposerOptionsFromState({
        initialComposerOptions: { mode: "plan", model: "model-a" },
      }),
    ).toEqual({
      status: "valid",
      options: { mode: "plan", model: "model-a" },
    });
    expect(
      initialComposerOptionsFromState({
        initialComposerOptions: { mode: "execute" },
      }),
    ).toEqual({ status: "invalid" });
    expect(
      initialComposerOptionsFromState({
        initialComposerOptions: { futureOption: "must-not-be-dropped" },
      }),
    ).toEqual({ status: "invalid" });
  });
});

describe("failed Chat handoff storage", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("round-trips bounded retry data including intent, steer, references, and uploads", () => {
    const options = {
      intent: "queued" as const,
      steer: true,
      references: [
        {
          type: "file" as const,
          path: "actions/hello.ts",
          name: "hello.ts",
          source: "workspace",
        },
      ],
      uploadedAttachments: [
        {
          type: "file" as const,
          name: "brief.pdf",
          mediaType: "application/pdf",
          url: "/uploads/brief.pdf",
        },
      ],
    };

    expect(
      writeFailedChatHandoff("thread-one", "Retry this request", options),
    ).toEqual({ status: "stored" });
    expect(readFailedChatHandoff("thread-one")).toEqual({
      status: "found",
      handoff: {
        text: "Retry this request",
        options: { mode: "act", ...options },
      },
    });

    expect(clearFailedChatHandoff("thread-one")).toEqual({
      status: "cleared",
    });
    expect(readFailedChatHandoff("thread-one")).toEqual({ status: "absent" });
  });

  it("omits nullish optional fields from composer references", () => {
    const reference = {
      type: "mention",
      path: "actions/hello.ts",
      name: "hello.ts",
      source: "workspace",
      refId: null,
      slotKey: undefined,
      slotLabel: null,
      metadata: null,
    } as never;

    expect(
      writeFailedChatHandoff("thread-one", "Use this action", {
        references: [reference],
      }),
    ).toEqual({ status: "stored" });
    expect(readFailedChatHandoff("thread-one")).toEqual({
      status: "found",
      handoff: {
        text: "Use this action",
        options: {
          mode: "act",
          references: [
            {
              type: "mention",
              path: "actions/hello.ts",
              name: "hello.ts",
              source: "workspace",
            },
          ],
        },
      },
    });
  });

  it("accepts the composer context limit and rejects values above it", () => {
    const contextItems = Array.from(
      { length: COMPOSER_CONTEXT_MAX_ITEMS },
      (_, index) => ({
        key: `context-${index}`,
        title: `Context ${index}`,
        context: `Use context ${index}.`,
      }),
    );

    expect(
      writeFailedChatHandoff("thread-one", "Use all context", {
        contextItems,
      }),
    ).toEqual({ status: "stored" });
    expect(readFailedChatHandoff("thread-one")).toMatchObject({
      status: "found",
      handoff: { options: { contextItems } },
    });
    expect(
      writeFailedChatHandoff("thread-one", "Too much context", {
        contextItems: [...contextItems, { ...contextItems[0]!, key: "extra" }],
      }),
    ).toEqual({ status: "invalid", reason: "invalid-options" });
    expect(readFailedChatHandoff("thread-one")).toEqual({ status: "absent" });
  });

  it("uses a tombstone when session storage refuses to remove a cleared handoff", () => {
    expect(
      writeFailedChatHandoff("thread-one", "Accepted request", {}),
    ).toEqual({ status: "stored" });
    const removeItem = vi
      .spyOn(window.sessionStorage, "removeItem")
      .mockImplementation(() => {
        throw new Error("storage remove failed");
      });

    expect(clearFailedChatHandoff("thread-one")).toEqual({
      status: "cleared",
    });
    expect(readFailedChatHandoff("thread-one")).toEqual({ status: "absent" });
    expect(
      window.sessionStorage.getItem(
        "agent-native.chat.failed-handoff:thread-one",
      ),
    ).toContain('"status":"cleared"');
    removeItem.mockRestore();
  });

  it("rejects oversized UTF-8 envelopes and non-serializable payloads", () => {
    expect(
      writeFailedChatHandoff("thread-one", "漢".repeat(24 * 1024), {}),
    ).toEqual({ status: "invalid", reason: "payload-too-large" });
    expect(
      writeFailedChatHandoff("thread-one", "Retry this", {
        uploadedAttachments: [
          {
            type: "file",
            name: "private image",
            url: "data:image/png;base64,abc",
          },
        ],
      }),
    ).toEqual({ status: "invalid", reason: "invalid-options" });
    expect(window.sessionStorage.length).toBe(0);
  });

  it("distinguishes unreadable session storage from an absent handoff", () => {
    const getItem = vi
      .spyOn(window.sessionStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("storage is unavailable");
      });

    expect(readFailedChatHandoff("thread-one")).toMatchObject({
      status: "unavailable",
      cause: expect.any(Error),
    });

    getItem.mockRestore();
  });
});
