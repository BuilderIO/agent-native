// @vitest-environment jsdom
import type { AssistantChatHandle } from "@agent-native/toolkit/app/chat";
import {
  act,
  createElement,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assistantChats: vi.fn(),
  changeTranscript: null as null | ((lines: unknown[]) => void),
  sendMessages: vi.fn(),
  listeners: new Map<string, (event: { payload?: unknown }) => void>(),
}));

vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentKitAssistantChat: forwardRef<
    AssistantChatHandle,
    Record<string, unknown>
  >((props, ref) => {
    mocks.assistantChats(props);
    useImperativeHandle(
      ref,
      () =>
        ({
          sendMessage: (...args: unknown[]) => {
            mocks.sendMessages(...args);
            return Promise.resolve({ status: "submitted" as const });
          },
          isRunning: () => false,
          exportThreadSnapshot: () => {
            return {
              threadData: JSON.stringify({ messages: [{ role: "user" }] }),
            };
          },
          setComposerContextItem: () => undefined,
          clearComposerContextItems: () => undefined,
        }) as unknown as AssistantChatHandle,
    );
    return createElement(
      "div",
      null,
      props.isActiveComposer === true
        ? (props.composerSlot as ReactNode)
        : null,
    );
  }),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  generateTabId: () => "test-thread",
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    key === "meetingAsk.resizeOrDismissAnswers"
      ? "Resize or dismiss answers"
      : key,
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
vi.mock("./live-transcript", () => ({
  LiveTranscript: ({
    onLinesChange,
  }: {
    onLinesChange: (lines: unknown[]) => void;
  }) => {
    mocks.changeTranscript = onLinesChange;
    return null;
  },
}));
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
    mocks.changeTranscript = null;
    mocks.sendMessages.mockReset();
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
        json: async () => ({ configured: true, chatEligible: false }),
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

  it("blocks visible sends and hidden suggestions when interactive chat is ineligible", async () => {
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
    await act(async () =>
      mocks.changeTranscript?.([
        {
          source: "mic",
          startMs: 0,
          text: "We should send the deck.",
          segments: [],
        },
      ]),
    );

    const expandButton = host.querySelector<HTMLButtonElement>(
      '[aria-label="Expand"]',
    );
    expect(expandButton).not.toBeNull();
    await act(async () => expandButton?.click());

    const chatProps = mocks.assistantChats.mock.calls.map(([props]) => props);
    const activeComposerProps = chatProps.filter(
      (props) => props.isActiveComposer === true,
    );
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
      activeComposerProps[activeComposerProps.length - 1]?.composerDisabled,
    ).toBe(true);
    expect(
      host.querySelectorAll(".pill-ask-provider-actions button"),
    ).toHaveLength(2);

    const onMessageCountChange = activeComposerProps[
      activeComposerProps.length - 1
    ]?.onMessageCountChange as (count: number) => void;
    vi.spyOn(Date, "now").mockReturnValue(60_001);
    await act(async () => onMessageCountChange(1));
    expect(
      host.querySelector<HTMLButtonElement>(".pill-ask-suggestions button")
        ?.disabled,
    ).toBe(true);
    expect(
      host.querySelector('[aria-label="Resize or dismiss answers"]'),
    ).not.toBeNull();
    expect(mocks.sendMessages).not.toHaveBeenCalled();
  });
});
