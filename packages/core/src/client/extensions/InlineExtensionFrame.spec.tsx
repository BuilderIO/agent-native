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
    localStorage.clear();
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
    expect(iframe?.getAttribute("sandbox")).toBe(
      "allow-scripts allow-forms allow-popups allow-downloads",
    );
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

  it("proxies passive output application-state writes from generated UI", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ value: { threshold: 42 } }), {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

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
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe?.contentWindow ?? window,
          data: {
            type: "agent-native-extension-request",
            requestId: "req-1",
            path: "/_agent-native/application-state/inline-ui:inline-test:output",
            options: {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                "X-Request-Source": "inline-ui",
              },
              body: JSON.stringify({ value: { threshold: 42 } }),
            },
          },
        }),
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/application-state/inline-ui:inline-test:output",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ value: { threshold: 42 } }),
        credentials: "same-origin",
      }),
    );
    const [, request] = fetchMock.mock.calls[0]!;
    expect((request as RequestInit).headers).toBeInstanceOf(Headers);
    const headers = (request as RequestInit).headers as Headers;
    expect(headers.get("X-Request-Source")).toBe("inline-ui");
    expect(headers.get("X-Agent-Native-Extension-Id")).toBe("inline-test");
  });

  it("honors extensionData.set scope from the request body in transient previews", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <InlineExtensionFrame
          extension={{
            id: "inline-test",
            mode: "transient",
            name: "Inline controls",
            content: "<button>Save</button>",
          }}
        />,
      );
    });

    const iframe = container.querySelector("iframe");
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe?.contentWindow ?? window,
          data: {
            type: "agent-native-extension-request",
            requestId: "req-1",
            path: "/_agent-native/extensions/data/inline-test/preferences",
            options: {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: "theme",
                data: { value: "dark" },
                scope: "org",
              }),
            },
          },
        }),
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        localStorage.getItem(
          "agent-native:inline-extension-data:inline-test:org:preferences",
        ) ?? "[]",
      ),
    ).toMatchObject([
      {
        id: "theme",
        scope: "org",
        orgId: "inline",
        data: JSON.stringify({ value: "dark" }),
      },
    ]);
    expect(
      localStorage.getItem(
        "agent-native:inline-extension-data:inline-test:user:preferences",
      ),
    ).toBeNull();
  });
});
