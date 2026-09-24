import type { BrowserContextV1 } from "@agent-native/core/browser-context";
import { describe, expect, it } from "vitest";

import {
  BROWSER_CHAT_READY_MESSAGE_TYPE,
  BROWSER_CHAT_RESULT_MESSAGE_TYPE,
  createStageMessage,
  createSubmitMessage,
  parseBrowserChatEvent,
} from "./browser-chat-protocol";

const context: BrowserContextV1 = {
  schema: "browser-context.v1",
  captureId: "capture-example",
  capturedAt: "2026-07-29T18:00:00.000Z",
  page: {
    url: "https://example.com/projects/launch",
    origin: "https://example.com",
    title: "Launch plan",
  },
  outcome: {
    state: "complete",
    projections: [
      {
        type: "readable",
        status: { state: "complete" },
        text: "Launch plan",
      },
    ],
  },
};
const browserSession = {
  version: 1 as const,
  handle: "bsn_12345678-1234-4123-8123-123456789abc",
  origin: "https://example.com",
  title: "Launch plan",
};

describe("browser chat postMessage protocol", () => {
  it("stages a bounded context with an opaque browser session", () => {
    expect(
      createStageMessage("nonce-example-123456789012", context, browserSession),
    ).toEqual({
      type: "browser-context.v1",
      nonce: "nonce-example-123456789012",
      intent: "stage",
      context,
      browserSession,
    });
    expect(
      createSubmitMessage(
        "nonce-example-123456789012",
        "Summarize the current page.",
        context,
        browserSession,
      ),
    ).toMatchObject({
      type: "browser-context.v1",
      intent: "submit",
      prompt: "Summarize the current page.",
      browserSession,
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

  it("strictly validates result messages", () => {
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
  });
});
