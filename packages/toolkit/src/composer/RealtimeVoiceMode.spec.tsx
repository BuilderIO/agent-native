// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import { createRealtimeVoiceAudioLevelStore } from "./realtime-voice-audio-level.js";
import {
  RealtimeVoiceComposerControls,
  RealtimeVoiceEndButton,
  type RealtimeVoiceModeCopy,
} from "./RealtimeVoiceMode.js";
import type { RealtimeVoiceModeApi } from "./useRealtimeVoiceMode.js";

const copy: RealtimeVoiceModeCopy = {
  startVoiceMode: "Start voice chat",
  endVoiceMode: "End voice chat",
  voiceSettings: "Voice settings",
  placeholder: "Listening…",
  muteMicrophone: "Mute microphone",
  unmuteMicrophone: "Unmute microphone",
  muteSpeaker: "Mute speaker",
  unmuteSpeaker: "Unmute speaker",
  settings: {
    microphone: "Microphone",
    defaultMicrophone: "System default",
    microphoneSwitchFailed: "Could not switch microphones.",
    language: "Language",
    autoLanguage: "Auto",
    languages: {
      en: "English",
      es: "Spanish",
      fr: "French",
      de: "German",
      it: "Italian",
      pt: "Portuguese",
      ja: "Japanese",
      ko: "Korean",
      zh: "Chinese",
    },
    intelligence: "Intelligence",
    intelligenceLevels: {
      instant: "Instant",
      balanced: "Balanced",
      deep: "Deep",
    },
    voiceStyle: "Voice style",
    voiceChangePending: "Voice changes apply to the next conversation.",
    voiceDescriptions: {
      marin: "Warm and natural",
      cedar: "Clear and grounded",
      coral: "Friendly and bright",
      sage: "Calm and thoughtful",
      verse: "Expressive and versatile",
      alloy: "Balanced and neutral",
      ash: "Smooth and confident",
      ballad: "Warm and expressive",
      echo: "Clear and direct",
      shimmer: "Light and upbeat",
    },
  },
  status: {
    connecting: "Connecting",
    listening: "Listening",
    speaking: "Speaking",
    working: "Working",
    error: "Voice mode needs attention",
    ending: "Ending voice mode",
  },
  approval: {
    question: (toolLabel) => `Approve to run ${toolLabel}?`,
    approve: "Approve",
    deny: "Deny",
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

function voiceSession(
  overrides: Partial<RealtimeVoiceModeApi> = {},
): RealtimeVoiceModeApi {
  return {
    state: "listening",
    active: true,
    errorMessage: null,
    audioLevels: createRealtimeVoiceAudioLevelStore(),
    inputMuted: false,
    outputMuted: false,
    setInputMuted: vi.fn(),
    setOutputMuted: vi.fn(),
    start: vi.fn(async () => {}),
    end: vi.fn(),
    dismissError: vi.fn(),
    approvals: [],
    resolveApproval: vi.fn(async () => {}),
    ...overrides,
  } as unknown as RealtimeVoiceModeApi;
}

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

function render(node: React.ReactNode) {
  act(() => root.render(<TooltipProvider>{node}</TooltipProvider>));
}

const slot = <T extends HTMLElement = HTMLElement>(name: string) =>
  document.querySelector<T>(`[data-agent-composer-slot="${name}"]`);

const renderControls = (voice: RealtimeVoiceModeApi) =>
  render(<RealtimeVoiceComposerControls voice={voice} copy={copy} />);

// oracle-change: the voice entry chooser, remembered input mode and floating dock were removed; voice chat runs from inline composer controls.
describe("RealtimeVoiceComposerControls", () => {
  it("shows who is speaking with live bars and a status", () => {
    renderControls(voiceSession({ state: "listening" }));
    const status = slot("voice-chat-status");
    expect(status?.dataset.voiceSpeaker).toBe("user");
    expect(status?.querySelectorAll("[data-voice-waveform-bar]")).toHaveLength(
      9,
    );
    expect(status?.querySelector('[role="status"]')?.textContent).toBe(
      "Listening",
    );

    renderControls(voiceSession({ state: "speaking" }));
    expect(slot("voice-chat-status")?.dataset.voiceSpeaker).toBe("assistant");
    expect(
      slot("voice-chat-status")?.querySelector("[data-voice-waveform]")
        ?.className,
    ).toContain("text-muted-foreground");
  });

  it("follows the speaking side's level and holds still under reduced motion", async () => {
    const audioLevels = createRealtimeVoiceAudioLevelStore();
    renderControls(voiceSession({ state: "speaking", audioLevels }));
    audioLevels.set({ input: 0, output: 1 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    const bars = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-voice-waveform-bar]"),
        (bar) => bar.style.transform,
      );
    expect(bars().at(-1)).toBe("scaleY(1)");

    act(() => root.unmount());
    root = createRoot(container);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    renderControls(voiceSession({ state: "speaking", audioLevels }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(new Set(bars())).toEqual(new Set(["scaleY(0.4)"]));
  });

  it("asks to approve a waiting tool call in place of the status", () => {
    const voice = voiceSession({
      state: "working",
      approvals: [{ callId: "call-delete", toolName: "delete-slide" }],
    });
    renderControls(voice);

    expect(slot("voice-chat-status")).toBeNull();
    const approval = slot("voice-chat-approval")!;
    expect(approval.querySelector('[role="status"]')?.textContent).toBe(
      "Approve to run Delete slide?",
    );
    const [approve, deny] = Array.from(approval.querySelectorAll("button"));
    act(() => approve!.click());
    act(() => deny!.click());
    expect(voice.resolveApproval).toHaveBeenNthCalledWith(
      1,
      "call-delete",
      true,
    );
    expect(voice.resolveApproval).toHaveBeenNthCalledWith(
      2,
      "call-delete",
      false,
    );
  });

  it("toggles speaker and microphone mute with pressed states", () => {
    const voice = voiceSession();
    renderControls(voice);

    const speaker = slot<HTMLButtonElement>("voice-chat-speaker")!;
    const microphone = slot<HTMLButtonElement>("voice-chat-microphone")!;
    expect(speaker.getAttribute("aria-label")).toBe("Mute speaker");
    expect(speaker.getAttribute("aria-pressed")).toBe("false");
    expect(speaker.querySelector("svg.tabler-icon-volume")).not.toBeNull();
    act(() => speaker.click());
    act(() => microphone.click());
    expect(voice.setOutputMuted).toHaveBeenCalledWith(true);
    expect(voice.setInputMuted).toHaveBeenCalledWith(true);

    renderControls(voiceSession({ inputMuted: true, outputMuted: true }));
    expect(slot("voice-chat-speaker")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      slot("voice-chat-speaker")?.querySelector("svg.tabler-icon-volume-off"),
    ).not.toBeNull();
    expect(
      slot("voice-chat-microphone")?.querySelector(
        "svg.tabler-icon-microphone-off",
      ),
    ).not.toBeNull();
  });

  it("keeps voice settings out of the composer", () => {
    renderControls(voiceSession());
    expect(slot("voice-chat-settings")).toBeNull();
    expect(document.querySelector("svg.tabler-icon-settings")).toBeNull();
  });

  it("shows a connecting status instead of bars", () => {
    renderControls(voiceSession({ state: "connecting" }));
    const status = slot("voice-chat-status");
    expect(status?.querySelector("[data-voice-waveform]")).toBeNull();
    expect(status?.querySelector(".animate-spin")).not.toBeNull();
    expect(status?.textContent).toContain("Connecting");
  });
});

describe("RealtimeVoiceEndButton", () => {
  it("ends voice chat from the primary slot without destructive styling", () => {
    const voice = voiceSession();
    render(<RealtimeVoiceEndButton voice={voice} copy={copy} />);

    const button = slot<HTMLButtonElement>("send-button")!;
    expect(button.dataset.composerPrimary).toBe("end-voice-chat");
    expect(button.getAttribute("aria-label")).toBe("End voice chat");
    expect(button.querySelector("svg.tabler-icon-x")).not.toBeNull();
    expect(button.className).not.toMatch(/destructive|red-/);
    act(() => button.click());
    expect(voice.end).toHaveBeenCalledOnce();
  });

  it("spins while connecting and still cancels", () => {
    const voice = voiceSession({ state: "connecting" });
    render(<RealtimeVoiceEndButton voice={voice} copy={copy} />);

    const button = slot<HTMLButtonElement>("send-button")!;
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector(".animate-spin")).not.toBeNull();
    act(() => button.click());
    expect(voice.end).toHaveBeenCalledOnce();
  });

  it("clears a failed session and locks while ending", () => {
    const failed = voiceSession({ state: "error" });
    render(<RealtimeVoiceEndButton voice={failed} copy={copy} />);
    act(() => slot<HTMLButtonElement>("send-button")!.click());
    expect(failed.dismissError).toHaveBeenCalledOnce();
    expect(failed.end).not.toHaveBeenCalled();

    render(
      <RealtimeVoiceEndButton
        voice={voiceSession({ state: "ending" })}
        copy={copy}
      />,
    );
    expect(slot<HTMLButtonElement>("send-button")?.disabled).toBe(true);
  });
});
