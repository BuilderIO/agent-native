// @vitest-environment happy-dom

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

  it("rejects oversized or non-serializable payloads instead of saving partial state", () => {
    expect(
      writeFailedChatHandoff("thread-one", "x".repeat(24 * 1024 + 1), {}),
    ).toEqual({ status: "invalid", reason: "message-too-large" });
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
