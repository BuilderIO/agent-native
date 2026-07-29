import type { BrowserContextV1 } from "@agent-native/core/browser-context";
import { describe, expect, it } from "vitest";

import {
  BROWSER_CHAT_READY_MESSAGE_TYPE,
  BROWSER_CHAT_RESULT_MESSAGE_TYPE,
  createStageMessage,
  createSubmitMessage,
  isLinkedInProfileUrl,
  parseBrowserChatEvent,
} from "./browser-chat-protocol";

const context: BrowserContextV1 = {
  schema: "browser-context.v1",
  captureId: "capture-example",
  capturedAt: "2026-07-29T18:00:00.000Z",
  page: {
    url: "https://www.linkedin.com/in/example-person/",
    origin: "https://www.linkedin.com",
    title: "Example Person",
  },
  outcome: {
    state: "complete",
    projections: [
      {
        type: "readable",
        status: { state: "complete" },
        text: "Example Person",
      },
    ],
  },
};

describe("browser chat postMessage protocol", () => {
  it("creates typed stage and review-only submit envelopes", () => {
    expect(createStageMessage("nonce-example-123456789012", context)).toEqual({
      type: "browser-context.v1",
      nonce: "nonce-example-123456789012",
      intent: "stage",
      context,
    });
    expect(
      createSubmitMessage(
        "nonce-example-123456789012",
        "Draft only. Do not send.",
        context,
      ),
    ).toMatchObject({
      type: "browser-context.v1",
      intent: "submit",
      prompt: "Draft only. Do not send.",
    });
  });

  it("requires exact iframe source, Dispatch origin, and nonce", () => {
    const frameWindow = {} as WindowProxy;
    const binding = {
      frameWindow,
      dispatchOrigin: "https://dispatch.agent-native.com",
      nonce: "nonce-example-123456789012",
    };
    const ready = {
      data: {
        type: BROWSER_CHAT_READY_MESSAGE_TYPE,
        nonce: binding.nonce,
      },
      origin: binding.dispatchOrigin,
      source: frameWindow,
    };

    expect(parseBrowserChatEvent(ready, binding)).toEqual(ready.data);
    expect(
      parseBrowserChatEvent(
        { ...ready, origin: "https://malicious.example" },
        binding,
      ),
    ).toBeNull();
    expect(
      parseBrowserChatEvent({ ...ready, source: {} as WindowProxy }, binding),
    ).toBeNull();
    expect(
      parseBrowserChatEvent(
        { ...ready, data: { ...ready.data, nonce: "wrong-nonce" } },
        binding,
      ),
    ).toBeNull();
  });

  it("strictly validates result messages and LinkedIn profile URLs", () => {
    const frameWindow = {} as WindowProxy;
    const binding = {
      frameWindow,
      dispatchOrigin: "https://dispatch.agent-native.com",
      nonce: "nonce-example-123456789012",
    };
    expect(
      parseBrowserChatEvent(
        {
          data: {
            type: BROWSER_CHAT_RESULT_MESSAGE_TYPE,
            nonce: binding.nonce,
            intent: "stage",
            captureId: context.captureId,
            ok: true,
          },
          origin: binding.dispatchOrigin,
          source: frameWindow,
        },
        binding,
      ),
    ).toMatchObject({ ok: true, intent: "stage" });
    expect(isLinkedInProfileUrl(context.page.url)).toBe(true);
    expect(isLinkedInProfileUrl("https://linkedin.com/feed/")).toBe(false);
    expect(isLinkedInProfileUrl("https://example.com/in/person")).toBe(false);
  });
});
