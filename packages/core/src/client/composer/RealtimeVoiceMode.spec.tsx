// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../components/ui/tooltip.js";
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
  startVoiceMode: "Start voice mode",
  keepDictating: "Keep dictating",
  showChat: "Show chat",
  hideChat: "Hide chat",
  endVoiceMode: "End voice mode",
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

    act(() => toggleChat?.click());

    expect(onToggleChat).toHaveBeenCalledOnce();
    expect(onEndVoiceMode).not.toHaveBeenCalled();
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
