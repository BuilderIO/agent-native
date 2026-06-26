// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendToAgentChat } from "../agent-chat.js";
import { InlineExtensionFrame } from "./InlineExtensionFrame.js";

vi.mock("../agent-chat.js", () => ({
  sendToAgentChat: vi.fn(),
}));

vi.mock("../../extensions/html-shell.js", () => ({
  buildExtensionHtml: (content: string) =>
    `<!doctype html><html><body>${content}</body></html>`,
}));

describe("InlineExtensionFrame", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(sendToAgentChat).mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("forwards generated UI chat messages to the host chat bridge", async () => {
    await act(async () => {
      root.render(
        <InlineExtensionFrame
          extension={{
            id: "inline-test",
            mode: "transient",
            name: "Inline controls",
            content: "<button>Send choice</button>",
          }}
          context={{ threadId: "thread-1" }}
        />,
      );
    });

    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(iframe?.getAttribute("srcdoc")).toContain("Send choice");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe?.contentWindow ?? window,
          data: {
            type: "agent-native-send-to-chat",
            message: "Use this threshold",
            context: { threshold: 42 },
            submit: true,
            openSidebar: false,
          },
        }),
      );
    });

    expect(sendToAgentChat).toHaveBeenCalledWith({
      message: "Use this threshold",
      context: JSON.stringify({ threshold: 42 }),
      submit: true,
      openSidebar: false,
    });
  });

  it("dispatches passive output events from generated UI", async () => {
    await act(async () => {
      root.render(
        <InlineExtensionFrame
          extension={{
            id: "inline-test",
            mode: "transient",
            name: "Inline controls",
            content: '<input type="range" />',
          }}
          context={{ threadId: "thread-1" }}
        />,
      );
    });

    const iframe = container.querySelector("iframe");
    const outputEvents: unknown[] = [];
    const listener = (event: Event) => {
      outputEvents.push((event as CustomEvent).detail);
    };
    window.addEventListener("agentNative.inlineUiOutput", listener);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe?.contentWindow ?? window,
          data: {
            type: "agent-native-ui-output",
            extensionId: "inline-test",
            key: "inline-ui:inline-test:output",
            value: { threshold: 42 },
            output: { value: { threshold: 42 } },
          },
        }),
      );
    });

    window.removeEventListener("agentNative.inlineUiOutput", listener);

    expect(outputEvents).toEqual([
      {
        extensionId: "inline-test",
        key: "inline-ui:inline-test:output",
        value: { threshold: 42 },
        output: { value: { threshold: 42 } },
      },
    ]);
  });
});
