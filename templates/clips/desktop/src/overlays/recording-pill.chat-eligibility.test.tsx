// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assistantChats: vi.fn(),
  listeners: new Map<string, (event: { payload?: unknown }) => void>(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  AgentKitAssistantChat: (props: Record<string, unknown>) => {
    mocks.assistantChats(props);
    return createElement(
      "div",
      null,
      props.isActiveComposer === true
        ? (props.composerSlot as ReactNode)
        : null,
    );
  },
  generateTabId: () => "test-thread",
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));

vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: async () => undefined,
  listen: (name: string, handler: (event: { payload?: unknown }) => void) => {
    mocks.listeners.set(name, handler);
    return Promise.resolve(() => {});
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    outerSize: async () => ({ width: 0, height: 0 }),
    scaleFactor: async () => 1,
    setSize: async () => undefined,
    onResized: async () => () => {},
    startDragging: async () => undefined,
  }),
}));

vi.mock("../components/live-waveform", () => ({ LiveWaveform: () => null }));
vi.mock("../lib/url", () => ({
  loadStoredServerUrl: () => "https://example.test",
}));
vi.mock("./live-transcript", () => ({ LiveTranscript: () => null }));
vi.mock("./pill-logo", () => ({ PillLogo: () => null }));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

describe("meeting pill chat eligibility", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.assistantChats.mockReset();
    mocks.listeners.clear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 0),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ configured: false }),
      })),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("routes setup through external settings instead of AgentKit's card", async () => {
    const { MeetingPill } = await import("./recording-pill");
    await act(async () => root.render(createElement(MeetingPill)));

    const onContext = mocks.listeners.get("clips:pill-context");
    expect(onContext).toBeDefined();
    await act(async () => {
      onContext?.({ payload: { mode: "meeting", meetingId: "meeting-1" } });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const expandButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Expand"]',
    );
    expect(expandButton).not.toBeNull();
    await act(async () => expandButton?.click());

    const chatProps = mocks.assistantChats.mock.calls.map(([props]) => props);
    expect(chatProps.some((props) => props.isActiveComposer === true)).toBe(
      true,
    );
    expect(chatProps.some((props) => props.isActiveComposer === false)).toBe(
      true,
    );
    expect(
      chatProps.every((props) => props.providerStatusChecksEnabled === false),
    ).toBe(true);
    expect(
      chatProps.filter((props) => props.isActiveComposer === true).at(-1)
        ?.composerDisabled,
    ).toBe(true);
    expect(
      host.querySelectorAll(".pill-ask-provider-actions button"),
    ).toHaveLength(2);
  });
});
