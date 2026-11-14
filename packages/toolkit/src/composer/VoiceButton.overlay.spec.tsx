// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import { createRealtimeVoiceAudioLevelStore } from "./realtime-voice-audio-level.js";
import type { VoiceDictationApi } from "./useVoiceDictation.js";
import { VoiceRecordingOverlay } from "./VoiceButton.js";

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

function failedDictation(
  overrides: Partial<VoiceDictationApi> = {},
): VoiceDictationApi {
  return {
    state: "error",
    levels: createRealtimeVoiceAudioLevelStore(),
    durationMs: 0,
    errorMessage: "Microphone access was blocked.",
    provider: "browser",
    supported: true,
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    cancel: vi.fn(),
    dismissError: vi.fn(),
    ...overrides,
  };
}

function renderOverlay(voice: VoiceDictationApi) {
  act(() =>
    root.render(
      <TooltipProvider>
        <VoiceRecordingOverlay voice={voice} />
      </TooltipProvider>,
    ),
  );
}

describe("VoiceRecordingOverlay dictation failure", () => {
  it("announces a recoverable failure as a warning, not a destructive error", () => {
    renderOverlay(failedDictation());

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Microphone access was blocked.");
    expect(alert?.className).toContain("--agent-kit-warning");
    expect(alert?.className).not.toMatch(/destructive|red-/);
    expect(
      alert
        ?.querySelector("svg.tabler-icon-alert-triangle")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    for (const button of alert?.querySelectorAll("button") ?? []) {
      expect(button.className).not.toMatch(/destructive|red-/);
    }
  });

  it("retries by clearing the error and starting dictation again", () => {
    const voice = failedDictation();
    renderOverlay(voice);

    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Try again",
    );
    act(() => retry?.click());

    expect(voice.dismissError).toHaveBeenCalledTimes(1);
    expect(voice.start).toHaveBeenCalledTimes(1);
  });

  it("keeps an accessible dismiss control", () => {
    const voice = failedDictation();
    renderOverlay(voice);

    const dismiss = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss"]',
    );
    act(() => dismiss?.click());

    expect(voice.dismissError).toHaveBeenCalledTimes(1);
    expect(voice.start).not.toHaveBeenCalled();
  });
});
