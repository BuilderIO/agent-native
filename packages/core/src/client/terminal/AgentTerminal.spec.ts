// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentTerminal, formatWebSocketHostname } from "./AgentTerminal.js";

const terminals: MockTerminal[] = [];

class MockTerminal {
  cols = 80;
  rows = 24;
  write = vi.fn();
  dispose = vi.fn();
  loadAddon = vi.fn();
  open = vi.fn();
  focus = vi.fn();
  onData = vi.fn((handler: (data: string) => void) => {
    this.emitData = handler;
    return { dispose: vi.fn() };
  });
  emitData: (data: string) => void = () => {};

  constructor(public options: unknown) {
    terminals.push(this);
  }
}

const fit = vi.fn();

vi.mock("@xterm/xterm", () => ({
  Terminal: MockTerminal,
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = fit;
  },
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    constructor(public handler?: unknown) {}
  },
}));

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(public callback: ResizeObserverCallback) {}
}

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  binaryType: BinaryType = "blob";
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    window.setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.(new Event("open"));
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close"));
  }

  receive(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }));
  }
}

describe("AgentTerminal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    terminals.length = 0;
    MockWebSocket.instances.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      window.setTimeout(() => cb(performance.now()), 0);
      return 1;
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function flushTimers() {
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
  }

  function renderTerminal(props: React.ComponentProps<typeof AgentTerminal>) {
    act(() => {
      root.render(React.createElement(AgentTerminal, props));
    });
  }

  async function waitForSocketCount(count: number) {
    await act(async () => {
      await vi.waitFor(() =>
        expect(MockWebSocket.instances).toHaveLength(count),
      );
    });
  }

  it("renders discovery errors from the terminal info endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({ available: false, error: "Terminal disabled" }),
    } as Response);

    renderTerminal({});
    await flushTimers();

    expect(container.textContent).toContain("Terminal disabled");
  });

  it("formats IPv6 hosts for WebSocket URLs", () => {
    expect(formatWebSocketHostname("::1")).toBe("[::1]");
    expect(formatWebSocketHostname("localhost")).toBe("localhost");
    expect(formatWebSocketHostname("[::1]")).toBe("[::1]");
  });

  it("discovers the WebSocket URL with the server command and flags", async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({
        available: true,
        wsPort: 12345,
        command: "builder",
      }),
    } as Response);

    renderTerminal({ flags: "--plan" });
    await flushTimers();
    await waitForSocketCount(1);

    expect(MockWebSocket.instances[0].url).toBe(
      `ws://${window.location.hostname}:12345/ws?command=builder&flags=--plan`,
    );
  });

  it("disposes stale setup when the provider changes during discovery", async () => {
    let resolveFirstResponse: ((response: Response) => void) | undefined;
    let resolveSecondResponse: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirstResponse = resolve;
    });
    const secondResponse = new Promise<Response>((resolve) => {
      resolveSecondResponse = resolve;
    });
    vi.mocked(fetch)
      .mockImplementationOnce(() => firstResponse)
      .mockImplementationOnce(() => secondResponse);

    const terminalInfoResponse = () =>
      ({
        json: async () => ({ available: true, wsPort: 12345 }),
      }) as Response;

    renderTerminal({ command: "codex" });
    await act(async () => {
      await vi.waitFor(() => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(terminals).toHaveLength(1);
      });
    });

    renderTerminal({ command: "claude" });
    await act(async () => {
      await vi.waitFor(() => {
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(terminals).toHaveLength(2);
      });
    });

    resolveFirstResponse?.(terminalInfoResponse());
    await act(async () => {
      await vi.waitFor(() =>
        expect(terminals[0]?.dispose).toHaveBeenCalledOnce(),
      );
    });
    expect(MockWebSocket.instances).toHaveLength(0);

    resolveSecondResponse?.(terminalInfoResponse());
    await flushTimers();
    await waitForSocketCount(1);

    expect(MockWebSocket.instances[0].url).toContain("command=claude");
    expect(terminals[1]?.dispose).not.toHaveBeenCalled();
  });

  it("keeps host authentication when adding the CLI command", async () => {
    renderTerminal({
      wsUrl: "ws://127.0.0.1:12345/ws?token=desktop-secret",
      command: "codex",
    });
    await waitForSocketCount(1);

    expect(MockWebSocket.instances[0].url).toBe(
      "ws://127.0.0.1:12345/ws?token=desktop-secret&command=codex",
    );
    expect(terminals[0]?.focus).toHaveBeenCalled();
    expect(terminals[0]?.write).not.toHaveBeenCalledWith(
      expect.stringContaining("[terminal]"),
    );
  });

  it("shows setup-status errors and suppresses reconnects", async () => {
    renderTerminal({
      wsUrl: "ws://127.0.0.1:12345/ws",
      command: "builder",
    });
    await waitForSocketCount(1);

    act(() => {
      MockWebSocket.instances[0].receive(
        JSON.stringify({
          type: "setup-status",
          status: "failed",
          message: "Invalid flags",
        }),
      );
      MockWebSocket.instances[0].close();
    });
    await flushTimers();

    expect(container.textContent).toContain("Invalid flags");
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("forwards same-origin chat submissions to the terminal only", async () => {
    const onAgentRunningChange = vi.fn();
    renderTerminal({
      wsUrl: "ws://127.0.0.1:12345/ws",
      command: "builder",
      onAgentRunningChange,
    });
    await waitForSocketCount(1);
    await flushTimers();

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://attacker.test",
        data: { type: "agentNative.submitChat", data: { message: "nope" } },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "agentNative.submitChat", data: { message: "hello" } },
      }),
    );

    expect(MockWebSocket.instances[0].sent).toContain("hello\r");
    expect(MockWebSocket.instances[0].sent).not.toContain("nope\r");
    expect(onAgentRunningChange).toHaveBeenCalledWith(true);
  });

  it("queues a submitted prompt until the terminal socket is ready", async () => {
    const onPromptSubmitted = vi.fn();
    renderTerminal({
      wsUrl: "ws://127.0.0.1:12345/ws",
      command: "builder",
      submitRequest: { id: "prompt-1", text: "launch the app" },
      onPromptSubmitted,
    });
    await waitForSocketCount(1);
    await flushTimers();

    expect(MockWebSocket.instances[0].sent).toContain("launch the app\r");
    expect(onPromptSubmitted).toHaveBeenCalledWith({
      id: "prompt-1",
      text: "launch the app",
    });
  });
});
