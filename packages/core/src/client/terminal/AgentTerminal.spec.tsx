// @vitest-environment jsdom
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTerminal } from "./AgentTerminal.js";

const terminals: MockTerminal[] = [];

class MockTerminal {
  cols = 80;
  rows = 24;
  write = vi.fn();
  dispose = vi.fn();
  loadAddon = vi.fn();
  open = vi.fn();
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
  FitAddon: vi.fn(() => ({ fit })),
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn(),
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
  beforeEach(() => {
    vi.useFakeTimers();
    terminals.length = 0;
    MockWebSocket.instances.length = 0;
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      window.setTimeout(() => cb(performance.now()), 0);
      return 1;
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function flushTimers() {
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
  }

  it("renders discovery errors from the terminal info endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({ available: false, error: "Terminal disabled" }),
    } as Response);

    render(<AgentTerminal />);
    await flushTimers();

    expect(await screen.findByText("Terminal disabled")).toBeInTheDocument();
  });

  it("discovers the WebSocket URL, including IPv6 hosts and flags", async () => {
    vi.stubGlobal("location", { protocol: "http:", hostname: "::1" });
    vi.mocked(fetch).mockResolvedValue({
      json: async () => ({
        available: true,
        wsPort: 12345,
        command: "builder",
      }),
    } as Response);

    render(<AgentTerminal flags="--plan" />);
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    expect(MockWebSocket.instances[0].url).toBe(
      "ws://[::1]:12345/ws?command=builder&flags=--plan",
    );
  });

  it("shows setup-status errors and suppresses reconnects", async () => {
    render(<AgentTerminal wsUrl="ws://127.0.0.1:12345/ws" command="builder" />);
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

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

    expect(await screen.findByText("Invalid flags")).toBeInTheDocument();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("forwards same-origin chat submissions to the terminal only", async () => {
    const onAgentRunningChange = vi.fn();
    render(
      <AgentTerminal
        wsUrl="ws://127.0.0.1:12345/ws"
        command="builder"
        onAgentRunningChange={onAgentRunningChange}
      />,
    );
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    await flushTimers();

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://attacker.test",
        data: { type: "builder.submitChat", data: { message: "nope" } },
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "builder.submitChat", data: { message: "hello" } },
      }),
    );

    expect(MockWebSocket.instances[0].sent).toContain("hello\r");
    expect(MockWebSocket.instances[0].sent).not.toContain("nope\r");
    expect(onAgentRunningChange).toHaveBeenCalledWith(true);
  });
});
