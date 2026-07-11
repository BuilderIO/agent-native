// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../components/ui/tooltip.js";
import { createRealtimeVoiceAudioLevelStore } from "./realtime-voice-audio-level.js";
import {
  RealtimeVoiceModeDock,
  RealtimeVoiceModeEntry,
  type RealtimeVoiceModeCopy,
} from "./RealtimeVoiceMode.js";

const copy: RealtimeVoiceModeCopy = {
  entryButtonLabel: "Use microphone",
  promptTitle: "Talk to your app",
  promptDescription:
    "Voice mode keeps listening while the agent navigates and takes actions.",
  setupTitle: "Set up voice mode",
  setupDescription: "Connect Builder or use your OpenAI key.",
  connectBuilder: "Connect Builder",
  useOpenAiKey: "Use OpenAI API key",
  startWithOpenAiKey: "Start with OpenAI key",
  startVoiceMode: "Start voice mode",
  keepDictating: "Keep dictating",
  showChat: "Show chat",
  hideChat: "Hide chat",
  endVoiceMode: "End voice mode",
  microphoneSettings: "Microphone settings",
  status: {
    connecting: "Connecting",
    listening: "Listening",
    speaking: "Speaking",
    working: "Working",
    error: "Voice mode needs attention",
    ending: "Ending voice mode",
  },
  errors: {
    unsupported: "Unsupported",
    responseFailed: "Response failed",
    sessionFailed: "Session failed",
    channelDisconnected: "Channel disconnected",
    connectionFailed: "Connection failed",
    offerFailed: "Offer failed",
  },
};

describe("RealtimeVoiceMode", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = (node: React.ReactNode) => {
    act(() => {
      root.render(<TooltipProvider>{node}</TooltipProvider>);
    });
  };

  it("offers voice mode before starting the existing dictation path", () => {
    const onStartVoiceMode = vi.fn();
    const onKeepDictating = vi.fn();

    render(
      <RealtimeVoiceModeEntry
        copy={copy}
        onStartVoiceMode={onStartVoiceMode}
        onKeepDictating={onKeepDictating}
      />,
    );

    const microphone = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Use microphone"]',
    );
    expect(microphone?.getAttribute("aria-expanded")).toBe("false");

    act(() => microphone?.click());

    expect(document.body.textContent).toContain("Talk to your app");
    const prompt = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(prompt?.className).toContain("w-[min(22rem,calc(100vw-2rem))]");
    expect(document.body.textContent).toContain("Keep dictating");
    expect(onStartVoiceMode).not.toHaveBeenCalled();
    expect(onKeepDictating).not.toHaveBeenCalled();

    const startVoiceMode = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Start voice mode"));
    act(() => startVoiceMode?.click());

    expect(onStartVoiceMode).toHaveBeenCalledOnce();
    expect(onKeepDictating).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Talk to your app");
  });

  it("keeps editable dictation available from the prompt", () => {
    const onStartVoiceMode = vi.fn();
    const onKeepDictating = vi.fn();

    render(
      <RealtimeVoiceModeEntry
        copy={copy}
        open
        onStartVoiceMode={onStartVoiceMode}
        onKeepDictating={onKeepDictating}
      />,
    );

    const keepDictating = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Keep dictating");
    act(() => keepDictating?.click());

    expect(onKeepDictating).toHaveBeenCalledOnce();
    expect(onStartVoiceMode).not.toHaveBeenCalled();
  });

  it("makes Builder the primary setup action and OpenAI the secondary", () => {
    const onConnectBuilder = vi.fn();
    const onUseOpenAiKey = vi.fn();

    render(
      <RealtimeVoiceModeEntry
        copy={copy}
        open
        setupRequired
        onStartVoiceMode={vi.fn()}
        onKeepDictating={vi.fn()}
        onConnectBuilder={onConnectBuilder}
        onUseOpenAiKey={onUseOpenAiKey}
      />,
    );

    expect(document.body.textContent).toContain("Set up voice mode");
    const prompt = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(prompt?.className).toContain("w-[min(30rem,calc(100vw-2rem))]");
    const actions = Array.from(prompt?.querySelectorAll("div") ?? []).find(
      (element) => element.className.includes("sm:flex-row"),
    );
    const actionClasses = actions?.className.split(/\s+/) ?? [];
    expect(actionClasses).toContain("sm:flex-nowrap");
    expect(actionClasses).not.toContain("sm:flex-wrap");
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    );
    expect(
      buttons.find((button) => button.textContent === "Connect Builder")
        ?.className,
    ).toContain("whitespace-nowrap");
    act(() =>
      buttons
        .find((button) => button.textContent === "Connect Builder")
        ?.click(),
    );
    expect(onConnectBuilder).toHaveBeenCalledOnce();
    expect(onUseOpenAiKey).not.toHaveBeenCalled();
  });

  it("toggles chat without ending the voice session", () => {
    const onToggleChat = vi.fn();
    const onEndVoiceMode = vi.fn();

    render(
      <RealtimeVoiceModeDock
        state="listening"
        copy={copy}
        chatVisible={false}
        onToggleChat={onToggleChat}
        onEndVoiceMode={onEndVoiceMode}
      />,
    );

    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Listening",
    );
    const toggleChat = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Show chat"]',
    );
    expect(toggleChat?.getAttribute("aria-pressed")).toBe("false");
    expect(toggleChat?.getAttribute("aria-expanded")).toBe("false");
    expect(
      document
        .querySelector("[data-realtime-voice-controls]")
        ?.getAttribute("data-realtime-voice-controls"),
    ).toBe("closed");

    act(() => toggleChat?.click());

    expect(onToggleChat).toHaveBeenCalledOnce();
    expect(onEndVoiceMode).not.toHaveBeenCalled();
    expect(toggleChat?.getAttribute("aria-expanded")).toBe("true");
    expect(
      document
        .querySelector("[data-realtime-voice-controls]")
        ?.getAttribute("data-realtime-voice-controls"),
    ).toBe("open");
  });

  it("progressively discloses working microphone and end-session controls", () => {
    const onOpenMicrophoneSettings = vi.fn();
    const onEndVoiceMode = vi.fn();

    render(
      <RealtimeVoiceModeDock
        state="listening"
        copy={copy}
        chatVisible={false}
        onToggleChat={vi.fn()}
        onEndVoiceMode={onEndVoiceMode}
        onOpenMicrophoneSettings={onOpenMicrophoneSettings}
      />,
    );

    const microphoneSettings = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Microphone settings"]',
    );
    const endVoiceMode = document.querySelector<HTMLButtonElement>(
      'button[aria-label="End voice mode"]',
    );

    act(() => microphoneSettings?.click());
    expect(onOpenMicrophoneSettings).toHaveBeenCalledOnce();
    expect(onEndVoiceMode).not.toHaveBeenCalled();

    act(() => endVoiceMode?.click());
    expect(onEndVoiceMode).toHaveBeenCalledOnce();
  });

  it("keeps the dock visible when chat opens itself", () => {
    render(
      <RealtimeVoiceModeDock
        state="listening"
        copy={copy}
        chatVisible={false}
        onToggleChat={vi.fn()}
        onEndVoiceMode={vi.fn()}
      />,
    );
    expect(
      document.querySelector("[data-realtime-voice-state]"),
    ).not.toBeNull();

    render(
      <RealtimeVoiceModeDock
        state="listening"
        copy={copy}
        chatVisible
        onToggleChat={vi.fn()}
        onEndVoiceMode={vi.fn()}
      />,
    );
    expect(
      document.querySelector("[data-realtime-voice-state]"),
    ).not.toBeNull();
    expect(
      document
        .querySelector('button[aria-label="Hide chat"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("shows a live waveform for user and assistant audio", () => {
    const audioLevels = createRealtimeVoiceAudioLevelStore();
    audioLevels.set({ input: 0.7, output: 0 });
    render(
      <RealtimeVoiceModeDock
        state="listening"
        copy={copy}
        chatVisible={false}
        audioLevels={audioLevels}
        onToggleChat={vi.fn()}
        onEndVoiceMode={vi.fn()}
      />,
    );
    expect(
      document.querySelector('[data-realtime-voice-activity="user"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-realtime-voice-waveform="true"]'),
    ).not.toBeNull();

    act(() => audioLevels.set({ input: 0, output: 0.8 }));
    expect(
      document.querySelector('[data-realtime-voice-activity="assistant"]'),
    ).not.toBeNull();
    expect(
      document.querySelector(
        '[data-realtime-voice-waveform-activity="assistant"]',
      ),
    ).not.toBeNull();
  });

  it("exposes error details and a separate end-session action", () => {
    const onToggleChat = vi.fn();
    const onEndVoiceMode = vi.fn();

    render(
      <RealtimeVoiceModeDock
        state="error"
        copy={copy}
        chatVisible
        errorMessage="The microphone disconnected."
        onToggleChat={onToggleChat}
        onEndVoiceMode={onEndVoiceMode}
      />,
    );

    expect(document.body.textContent).toContain("The microphone disconnected.");
    const endVoiceMode = document.querySelector<HTMLButtonElement>(
      'button[aria-label="End voice mode"]',
    );
    act(() => endVoiceMode?.click());

    expect(onEndVoiceMode).toHaveBeenCalledOnce();
    expect(onToggleChat).not.toHaveBeenCalled();
  });

  it("locks the dock while the session is ending", () => {
    render(
      <RealtimeVoiceModeDock
        state="ending"
        copy={copy}
        chatVisible={false}
        onToggleChat={vi.fn()}
        onEndVoiceMode={vi.fn()}
      />,
    );

    expect(
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Show chat"]',
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="End voice mode"]',
      )?.disabled,
    ).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Ending voice mode",
    );
  });
});
