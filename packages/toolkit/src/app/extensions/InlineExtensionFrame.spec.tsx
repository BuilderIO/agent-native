import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InlineExtensionFrame } from "./InlineExtensionFrame.js";

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: vi.fn(),
}));

vi.mock("@agent-native/core/extensions/html-shell", () => ({
  buildExtensionHtml: (
    content: string,
    _themeVars: string,
    _isDark: boolean,
    _extensionId?: string,
    _binding?: unknown,
    metaCsp?: string,
  ) =>
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${metaCsp ?? ""}" /></head><body>${content}</body></html>`,
}));

vi.mock("./iframe-display-sources.js", () => ({
  useExtensionIframeMetaCsp: (enabled = true) =>
    enabled ? "img-src 'self' https://cdn.example.com;" : undefined,
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
    vi.restoreAllMocks();
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
      "allow-scripts allow-forms allow-downloads",
    );
    expect(iframe?.getAttribute("srcdoc")).toContain("Send choice");
    expect(iframe?.getAttribute("srcdoc")).toContain(
      `content="img-src 'self' https://cdn.example.com;"`,
    );

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
    expect(iframe?.getAttribute("aria-disabled")).toBe("true");
    expect(iframe?.style.pointerEvents).toBe("none");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe?.contentWindow,
          data: {
            type: "agent-native-send-to-chat",
            message: "Again",
            submit: true,
          },
        }),
      );
    });
    expect(sendToAgentChat).toHaveBeenCalledTimes(1);
  });

  it("keeps extension chat messages draft-only without explicit submission", async () => {
    await act(async () => {
      root.render(
        <InlineExtensionFrame
          extension={{
            id: "inline-test",
            mode: "transient",
            name: "Inline controls",
            content: "<button>Send choice</button>",
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
            type: "agent-native-send-to-chat",
            message: "A refresh error",
          },
        }),
      );
    });

    expect(sendToAgentChat).toHaveBeenCalledWith({
      message: "A refresh error",
      context: undefined,
      submit: false,
      openSidebar: true,
    });
  });

  it("ignores duplicate submit events for transient extensions", async () => {
    await act(async () => {
      root.render(
        <InlineExtensionFrame
          extension={{
            id: "inline-test",
            mode: "transient",
            name: "Inline controls",
            content: "<button>Send</button>",
          }}
        />,
      );
    });

    const iframe = container.querySelector("iframe");
    const sendEvent = {
      type: "agent-native-send-to-chat",
      message: "One-time action",
      submit: true,
    };

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe?.contentWindow ?? window,
          data: sendEvent,
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe?.contentWindow ?? window,
          data: sendEvent,
        }),
      );
    });

    expect(sendToAgentChat).toHaveBeenCalledTimes(1);
    expect(sendToAgentChat).toHaveBeenCalledWith({
      message: "One-time action",
      context: undefined,
      submit: true,
      openSidebar: true,
    });
  });

  it("resets the transient submit latch when replacement content changes", async () => {
    await act(async () => {
      root.render(
        <InlineExtensionFrame
          extension={{
            id: "inline-test",
            mode: "transient",
            name: "Inline controls",
            content: "<button>First</button>",
          }}
        />,
      );
    });

    const firstIframe = container.querySelector("iframe");
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: firstIframe?.contentWindow ?? window,
          data: {
            type: "agent-native-send-to-chat",
            message: "First action",
            submit: true,
          },
        }),
      );
    });

    await act(async () => {
      root.render(
        <InlineExtensionFrame
          extension={{
            id: "inline-test",
            mode: "transient",
            name: "Inline controls",
            content: "<button>Replacement</button>",
          }}
        />,
      );
    });

    const replacementIframe = container.querySelector("iframe");
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: replacementIframe?.contentWindow ?? window,
          data: {
            type: "agent-native-send-to-chat",
            message: "Replacement action",
            submit: true,
          },
        }),
      );
    });

    expect(sendToAgentChat).toHaveBeenCalledTimes(2);
    expect(sendToAgentChat).toHaveBeenLastCalledWith({
      message: "Replacement action",
      context: undefined,
      submit: true,
      openSidebar: true,
    });
  });

  it("keeps opening links with the live document's token after a re-render that doesn't reload it", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const extension = {
      id: "inline-links",
      mode: "transient" as const,
      name: "Links",
      content: '<a href="https://app.hubspot.com/x" target="_blank">x</a>',
    };
    await act(async () => {
      root.render(
        <InlineExtensionFrame extension={extension} initialHeight={200} />,
      );
    });
    const iframe = container.querySelector("iframe");
    const frameWindow = iframe?.contentWindow as Window;
    const post = (data: unknown) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", { source: frameWindow, data }),
        );
      });
    const token = "c".repeat(32);
    post({
      type: "agent-native-extension-binding",
      binding: { role: "owner", isAuthor: true },
      openUrlToken: token,
    });

    // initialHeight resets the binding latch, but the iframe keeps its document.
    await act(async () => {
      root.render(
        <InlineExtensionFrame extension={extension} initialHeight={320} />,
      );
    });
    expect(container.querySelector("iframe")?.contentWindow).toBe(frameWindow);

    post({
      type: "agent-native-extension-open-url",
      url: "https://app.hubspot.com/x",
      token,
    });
    expect(open).toHaveBeenCalledWith(
      "https://app.hubspot.com/x",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("binds the open-url token to the document the host loaded, not to re-renders", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const extension = {
      id: "inline-links-doc",
      mode: "transient" as const,
      name: "Links",
      content: '<a href="https://app.hubspot.com/x" target="_blank">x</a>',
    };
    const render = async (props: {
      content?: string;
      initialHeight?: number;
    }) =>
      act(async () => {
        root.render(
          <InlineExtensionFrame
            extension={{
              ...extension,
              content: props.content ?? extension.content,
            }}
            initialHeight={props.initialHeight ?? 200}
          />,
        );
      });
    const post = (data: unknown) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: container.querySelector("iframe")?.contentWindow,
            data,
          }),
        );
      });
    const bind = (token: string) =>
      post({
        type: "agent-native-extension-binding",
        binding: { role: "owner", isAuthor: true },
        openUrlToken: token,
      });
    const openWith = (token: string) =>
      post({
        type: "agent-native-extension-open-url",
        url: "https://example.com/",
        token,
      });

    await render({});
    bind("a".repeat(32));

    // The frame navigated to another page, then a host-only re-render reset
    // the binding latch. That page's binding must not latch a new token.
    const firstFrame = container.querySelector("iframe");
    await render({ initialHeight: 320 });
    expect(container.querySelector("iframe")).toBe(firstFrame);
    bind("b".repeat(32));
    openWith("b".repeat(32));
    expect(open).not.toHaveBeenCalled();

    // New content is a new document from the host, in a fresh iframe element.
    // A binding still queued from the previous document's window is ignored,
    // and the new document's token latches.
    // (Browsers keep one window per iframe element across its documents, so
    // the element itself must be new; happy-dom swaps windows on srcdoc
    // changes regardless, which is why this checks the element.)
    const previousFrame = container.querySelector("iframe");
    const previousWindow = previousFrame?.contentWindow;
    await render({ content: "<a href='https://example.com/'>y</a>" });
    expect(container.querySelector("iframe")).not.toBe(previousFrame);
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: previousWindow,
          data: {
            type: "agent-native-extension-binding",
            binding: { role: "owner", isAuthor: true },
            openUrlToken: "d".repeat(32),
          },
        }),
      );
    });
    bind("c".repeat(32));
    openWith("d".repeat(32));
    expect(open).not.toHaveBeenCalled();
    openWith("c".repeat(32));
    expect(open).toHaveBeenCalledTimes(1);
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
    expect(headers.get("X-Agent-Native-Browser-Tab")).toEqual(
      expect.any(String),
    );
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
