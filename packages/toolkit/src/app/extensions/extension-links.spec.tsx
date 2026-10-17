// @vitest-environment happy-dom
import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const embedState = vi.hoisted(() => ({ active: false }));
const chatMocks = vi.hoisted(() => ({ openMcpAppHostLink: vi.fn() }));

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  openMcpAppHostLink: chatMocks.openMcpAppHostLink,
}));

vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  isEmbedMcpChatBridgeActive: () => embedState.active,
}));

import {
  EXTENSION_LINK_CHANNEL_ACK_MESSAGE_TYPE,
  EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE,
  EXTENSION_LINK_CHANNEL_READY_MESSAGE_TYPE,
  EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
} from "@agent-native/core/extensions/html-shell";

import {
  extensionFrameUrlWithLinkNonce,
  useExternalExtensionLinks,
} from "./extension-links.js";

function LinkFrame({
  onHostPortReady,
}: {
  onHostPortReady?: (port: MessagePort) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const nonce = useExternalExtensionLinks(iframeRef, "stable-frame", {
    onReady: () =>
      iframeRef.current?.setAttribute("data-link-channel-ready", "true"),
    onHostPortReady,
  });

  return (
    <iframe
      ref={iframeRef}
      key={nonce ?? "no-nonce"}
      srcDoc={
        nonce ? `<script data-link-nonce="${nonce}"></script>` : undefined
      }
      sandbox="allow-scripts allow-forms"
    />
  );
}

describe("useExternalExtensionLinks", () => {
  let container: HTMLDivElement;
  let root: Root;
  const ports = new Set<MessagePort>();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    embedState.active = false;
    chatMocks.openMcpAppHostLink.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    container.remove();
    for (const port of ports) port.close();
    ports.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function connectFrame(
    onHostPortReady?: (port: MessagePort) => void,
    options: { initialLoadBeforeHello?: boolean; acknowledge?: boolean } = {},
  ) {
    await act(async () => {
      root.render(<LinkFrame onHostPortReady={onHostPortReady} />);
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector("iframe")?.getAttribute("srcdoc"),
      ).toContain("data-link-nonce=");
    });

    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const nonce =
      iframe.getAttribute("srcdoc")?.match(/data-link-nonce="([^"]+)"/)?.[1] ??
      "";
    expect(nonce).toMatch(/^[0-9a-f]{48}$/);

    if (options.initialLoadBeforeHello) {
      act(() => iframe.dispatchEvent(new Event("load")));
    }

    const channel = new MessageChannel();
    ports.add(channel.port1);
    ports.add(channel.port2);
    channel.port1.start();
    const ready = new Promise<void>((resolve) => {
      channel.port1.addEventListener("message", function onMessage(event) {
        if (event.data?.type !== EXTENSION_LINK_CHANNEL_READY_MESSAGE_TYPE) {
          return;
        }
        channel.port1.removeEventListener("message", onMessage);
        if (options.acknowledge !== false) {
          channel.port1.postMessage({
            type: EXTENSION_LINK_CHANNEL_ACK_MESSAGE_TYPE,
          });
        }
        resolve();
      });
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE,
            nonce,
          },
          origin: "null",
          source: iframe.contentWindow,
          ports: [channel.port2],
        }),
      );
    });
    await ready;
    if (options.acknowledge !== false) {
      await vi.waitFor(() => {
        expect(iframe.getAttribute("data-link-channel-ready")).toBe("true");
      });
    }

    return { iframe, nonce, childPort: channel.port1 };
  }

  async function sendExternalLink(
    href: string,
    options: { openInNewContext?: boolean; userActivated?: boolean } = {},
  ) {
    const frame = await connectFrame();
    vi.stubGlobal("navigator", {
      ...navigator,
      userActivation: { isActive: options.userActivated ?? true },
    });
    await act(async () => {
      frame.childPort.postMessage({
        type: EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
        href,
        ...(options.openInNewContext === undefined
          ? {}
          : { openInNewContext: options.openInNewContext }),
      });
    });
    return frame;
  }

  it("keeps the nonce and encoded app fragment in the reserved hash grammar", () => {
    const source =
      "https://analytics.example/dashboard?view=compact#metric?range=7d&group=team%20alpha";
    const nonce = "a1b2c3";
    const originalFragment = new URL(source).hash.slice(1);
    const frameUrl = new URL(extensionFrameUrlWithLinkNonce(source, nonce));

    expect(frameUrl.hash).toBe(
      `#__agent_native_link_nonce=${nonce}&__agent_native_app_fragment=${encodeURIComponent(originalFragment)}`,
    );
    expect(frameUrl.search).toBe("?view=compact");
    expect(frameUrl.searchParams.has("__agent_native_link_nonce")).toBe(false);
  });

  it("encodes an app fragment that resembles the reserved marker", () => {
    const source =
      "https://analytics.example/dashboard#__agent_native_link_nonce=app&tab=one";
    const originalFragment = new URL(source).hash.slice(1);
    const frameUrl = new URL(extensionFrameUrlWithLinkNonce(source, "a1b2c3"));

    expect(frameUrl.hash).toBe(
      `#__agent_native_link_nonce=a1b2c3&__agent_native_app_fragment=${encodeURIComponent(originalFragment)}`,
    );
  });

  it("only grants a host bridge port once for a document nonce", async () => {
    const hostPorts: MessagePort[] = [];
    const frame = await connectFrame((port) => {
      hostPorts.push(port);
      ports.add(port);
    });
    expect(hostPorts).toHaveLength(1);

    // The first document's hello can precede the iframe element's load event.
    act(() => frame.iframe.dispatchEvent(new Event("load")));

    // A replacement document shares the WindowProxy and opaque origin, and
    // can attempt to replay the first document's nonce before its load event.
    const replay = new MessageChannel();
    ports.add(replay.port1);
    ports.add(replay.port2);
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE,
            nonce: frame.nonce,
          },
          origin: "null",
          source: frame.iframe.contentWindow,
          ports: [replay.port2],
        }),
      );
    });
    act(() => frame.iframe.dispatchEvent(new Event("load")));

    expect(hostPorts).toHaveLength(1);
  });

  it("accepts a same-nonce retry until the child acknowledges the channel", async () => {
    const hostPorts: MessagePort[] = [];
    const frame = await connectFrame(
      (port) => {
        hostPorts.push(port);
        ports.add(port);
      },
      { acknowledge: false },
    );
    expect(hostPorts).toHaveLength(1);

    const retry = new MessageChannel();
    ports.add(retry.port1);
    ports.add(retry.port2);
    retry.port1.start();
    const retryReady = new Promise<void>((resolve) => {
      retry.port1.addEventListener("message", function onMessage(event) {
        if (event.data?.type !== EXTENSION_LINK_CHANNEL_READY_MESSAGE_TYPE) {
          return;
        }
        retry.port1.removeEventListener("message", onMessage);
        resolve();
      });
    });
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE,
            nonce: frame.nonce,
          },
          origin: "null",
          source: frame.iframe.contentWindow,
          ports: [retry.port2],
        }),
      );
    });
    await retryReady;
    expect(hostPorts).toHaveLength(2);

    act(() => {
      retry.port1.postMessage({
        type: EXTENSION_LINK_CHANNEL_ACK_MESSAGE_TYPE,
      });
    });
    await vi.waitFor(() => {
      expect(frame.iframe.getAttribute("data-link-channel-ready")).toBe("true");
    });

    const replay = new MessageChannel();
    ports.add(replay.port1);
    ports.add(replay.port2);
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE,
            nonce: frame.nonce,
          },
          origin: "null",
          source: frame.iframe.contentWindow,
          ports: [replay.port2],
        }),
      );
    });
    expect(hostPorts).toHaveLength(2);
  });

  it("reconnects the acknowledged channel after a BFCache restore", async () => {
    const hostPorts: MessagePort[] = [];
    const frame = await connectFrame((port) => {
      hostPorts.push(port);
      ports.add(port);
    });
    expect(hostPorts).toHaveLength(1);

    const pagehide = new Event("pagehide");
    Object.defineProperty(pagehide, "persisted", { value: true });
    act(() => window.dispatchEvent(pagehide));

    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    act(() => window.dispatchEvent(pageshow));

    const restored = new MessageChannel();
    ports.add(restored.port1);
    ports.add(restored.port2);
    restored.port1.start();
    const ready = new Promise<void>((resolve) => {
      restored.port1.addEventListener("message", function onMessage(event) {
        if (event.data?.type !== EXTENSION_LINK_CHANNEL_READY_MESSAGE_TYPE) {
          return;
        }
        restored.port1.removeEventListener("message", onMessage);
        restored.port1.postMessage({
          type: EXTENSION_LINK_CHANNEL_ACK_MESSAGE_TYPE,
        });
        resolve();
      });
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE,
            nonce: frame.nonce,
          },
          origin: "null",
          source: frame.iframe.contentWindow,
          ports: [restored.port2],
        }),
      );
    });
    await ready;
    await vi.waitFor(() => {
      expect(hostPorts).toHaveLength(2);
      expect(frame.iframe.getAttribute("data-link-channel-ready")).toBe("true");
    });
  });

  it("recovers when a frame navigates after its initial handshake", async () => {
    const frame = await connectFrame(undefined, {
      initialLoadBeforeHello: true,
    });
    const originalIframe = frame.iframe;
    vi.useFakeTimers();
    act(() => originalIframe.dispatchEvent(new Event("load")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    const recoveredIframe = container.querySelector(
      "iframe",
    ) as HTMLIFrameElement;
    const recoveredNonce =
      recoveredIframe
        .getAttribute("srcdoc")
        ?.match(/data-link-nonce="([^"]+)"/)?.[1] ?? "";
    expect(recoveredNonce).not.toBe(frame.nonce);
  });

  it("falls back immediately when the MCP host declines synchronously", async () => {
    const href = "https://example.com/metric";
    embedState.active = true;
    chatMocks.openMcpAppHostLink.mockReturnValue(false);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    await sendExternalLink(href);

    expect(chatMocks.openMcpAppHostLink).toHaveBeenCalledWith(href);
    expect(open).toHaveBeenCalledWith(href, "_blank", "noopener,noreferrer");
  });

  it.each([
    ["resolves false", () => Promise.resolve(false), "navigate"],
    [
      "rejects",
      () => Promise.reject(new Error("host unavailable")),
      "navigate",
    ],
    ["resolves true", () => Promise.resolve(true), "close"],
  ] as const)(
    "uses the reserved tab when MCP host %s",
    async (_label, request, action) => {
      const href = "https://example.com/metric";
      embedState.active = true;
      chatMocks.openMcpAppHostLink.mockImplementation(request);
      const state = { closed: false };
      const popup = {
        get closed() {
          return state.closed;
        },
        opener: window,
        close: vi.fn(() => {
          state.closed = true;
        }),
        location: { replace: vi.fn() },
      } as unknown as Window;
      const open = vi.spyOn(window, "open").mockImplementation(() => popup);

      await sendExternalLink(href);
      await vi.waitFor(() => {
        expect(
          action === "close" ? popup.close : popup.location.replace,
        ).toHaveBeenCalled();
      });

      expect(open).toHaveBeenCalledWith("about:blank", "_blank");
      expect(popup.opener).toBeNull();
      if (action === "navigate") {
        expect(popup.location.replace).toHaveBeenCalledWith(href);
        expect(popup.close).not.toHaveBeenCalled();
      } else {
        expect(popup.close).toHaveBeenCalledTimes(1);
        expect(popup.location.replace).not.toHaveBeenCalled();
      }
    },
  );

  it("keeps standard-browser links on the existing direct popup path", async () => {
    const href = "https://example.com/metric";
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    await sendExternalLink(href);

    expect(chatMocks.openMcpAppHostLink).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(href, "_blank", "noopener,noreferrer");
  });

  it("rejects same-origin links unless the core router marks a new context", async () => {
    const href = new URL("/dashboards/metric", window.location.href).href;
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    await sendExternalLink(href);

    expect(open).not.toHaveBeenCalled();
    expect(chatMocks.openMcpAppHostLink).not.toHaveBeenCalled();
  });

  it("allows a same-origin link when explicitly opened in a new context", async () => {
    const href = new URL("/dashboards/metric", window.location.href).href;
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    await sendExternalLink(href, { openInNewContext: true });

    expect(open).toHaveBeenCalledWith(href, "_blank", "noopener,noreferrer");
  });

  it("does not open extension API routes outside their iframe sandbox", async () => {
    const href = new URL(
      "/_agent-native/extensions/ext-1/render",
      window.location.href,
    ).href;
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    await sendExternalLink(href, { openInNewContext: true });

    expect(open).not.toHaveBeenCalled();
    expect(chatMocks.openMcpAppHostLink).not.toHaveBeenCalled();
  });

  it("routes explicitly opened same-origin links through the MCP host", async () => {
    const href = new URL("/dashboards/metric", window.location.href).href;
    embedState.active = true;
    chatMocks.openMcpAppHostLink.mockReturnValue(false);
    vi.spyOn(window, "open").mockImplementation(() => null);

    await sendExternalLink(href, { openInNewContext: true });

    expect(chatMocks.openMcpAppHostLink).toHaveBeenCalledWith(href);
  });

  it.each([
    "javascript:alert(1)",
    "ftp://example.com/metric",
    "https://user:password@example.com/metric",
  ])(
    "does not let openInNewContext bypass URL validation for %s",
    async (href) => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);

      await sendExternalLink(href, { openInNewContext: true });

      expect(open).not.toHaveBeenCalled();
      expect(chatMocks.openMcpAppHostLink).not.toHaveBeenCalled();
    },
  );

  it("still requires user activation for explicitly opened same-origin links", async () => {
    const href = new URL("/dashboards/metric", window.location.href).href;
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    await sendExternalLink(href, {
      openInNewContext: true,
      userActivated: false,
    });

    expect(open).not.toHaveBeenCalled();
    expect(chatMocks.openMcpAppHostLink).not.toHaveBeenCalled();
  });
});
