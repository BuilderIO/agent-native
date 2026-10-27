// @vitest-environment happy-dom

import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import { createRealtimeVoiceAudioLevelStore } from "./realtime-voice-audio-level.js";
import {
  ComposerRuntimeAdaptersProvider,
  type ComposerRuntimeAdapters,
} from "./runtime-adapters.js";
import type {
  UseVoiceDictationOptions,
  VoiceDictationApi,
} from "./useVoiceDictation.js";

const voice = vi.hoisted(() => ({
  state: "idle" as VoiceDictationApi["state"],
  errorMessage: null as string | null,
  options: null as UseVoiceDictationOptions | null,
  levels: null as ReturnType<typeof createRealtimeVoiceAudioLevelStore> | null,
  start: (() => {}) as unknown as ReturnType<typeof vi.fn>,
  stop: (() => {}) as unknown as ReturnType<typeof vi.fn>,
  cancel: (() => {}) as unknown as ReturnType<typeof vi.fn>,
}));

const realtime = vi.hoisted(() => ({
  active: false,
  state: "idle" as string,
  errorMessage: null as string | null,
  start: (() => {}) as unknown as ReturnType<typeof vi.fn>,
  end: (() => {}) as unknown as ReturnType<typeof vi.fn>,
  dismissError: (() => {}) as unknown as ReturnType<typeof vi.fn>,
  setInputMuted: (() => {}) as unknown as ReturnType<typeof vi.fn>,
  setOutputMuted: (() => {}) as unknown as ReturnType<typeof vi.fn>,
}));

vi.mock("./useVoiceDictation.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./useVoiceDictation.js")>();
  return {
    ...actual,
    useVoiceDictation: (
      options: UseVoiceDictationOptions,
    ): VoiceDictationApi => {
      voice.options = options;
      return {
        state: voice.state,
        levels: voice.levels!,
        durationMs: 65_000,
        errorMessage: voice.errorMessage,
        provider: "browser",
        supported: true,
        start: voice.start,
        stop: voice.stop,
        cancel: voice.cancel,
        dismissError: vi.fn(),
      };
    },
  };
});

const realtimeLevels = createRealtimeVoiceAudioLevelStore();

vi.mock("./useRealtimeVoiceMode.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./useRealtimeVoiceMode.js")>();
  return {
    ...actual,
    useRealtimeVoiceModeOptional: () =>
      ({
        ...realtime,
        audioLevels: realtimeLevels,
        inputMuted: false,
        outputMuted: false,
        preferences: actual.DEFAULT_REALTIME_VOICE_PREFERENCES,
        microphones: [],
        microphoneDeviceId: "default",
        microphoneSwitching: false,
        microphoneError: null,
        voiceChangePending: false,
        setLanguage: () => {},
        setIntelligence: () => {},
        setVoice: () => {},
        setMicrophone: async () => {},
      }) as unknown as ReturnType<typeof actual.useRealtimeVoiceModeOptional>,
  };
});

const { TiptapComposer } = await import("./TiptapComposer.js");
type TiptapComposerProps = import("./TiptapComposer.js").TiptapComposerProps;

const emptyChatModelAdapter = {
  async *run() {},
};

const realtimeReady: ComposerRuntimeAdapters = {
  voice: {
    useProviderStatus: () => ({
      status: { builder: true, openai: false },
      refresh: () => {},
    }),
  },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Drafts persist per composer; each test starts from an empty one.
  localStorage.clear();
  sessionStorage.clear();
  voice.state = "idle";
  voice.errorMessage = null;
  voice.options = null;
  voice.levels = createRealtimeVoiceAudioLevelStore();
  voice.start = vi.fn(async () => {});
  voice.stop = vi.fn();
  voice.cancel = vi.fn();
  realtime.active = false;
  realtime.state = "idle";
  realtime.errorMessage = null;
  realtime.start = vi.fn(async () => {});
  realtime.end = vi.fn();
  realtime.dismissError = vi.fn();
  realtime.setInputMuted = vi.fn();
  realtime.setOutputMuted = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function Harness({
  adapters,
  ...props
}: Partial<TiptapComposerProps> & { adapters?: ComposerRuntimeAdapters }) {
  const runtime = useLocalRuntime(emptyChatModelAdapter);
  const composer = (
    <TiptapComposer
      voiceEnabled
      includeDefaultSlashSkills={false}
      plusMenuMode="hidden"
      {...props}
    />
  );
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        {adapters ? (
          <ComposerRuntimeAdaptersProvider adapters={adapters}>
            {composer}
          </ComposerRuntimeAdaptersProvider>
        ) : (
          composer
        )}
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}

const slot = <T extends HTMLElement = HTMLElement>(name: string) =>
  container.querySelector<T>(`[data-agent-composer-slot="${name}"]`);

function composerRows() {
  const root = slot("toolbar")?.parentElement;
  return Array.from(root?.children ?? []).map(
    (child) => child.getAttribute("data-agent-composer-slot") ?? child.tagName,
  );
}

// Slots after the spacer, in order; Tooltip triggers render the button itself.
function trailing() {
  const children = Array.from(slot("toolbar")!.children);
  const start = children.findIndex(
    (child) =>
      child.getAttribute("data-agent-composer-slot") === "toolbar-spacer",
  );
  return children
    .slice(start + 1)
    .map((child) => child.getAttribute("data-agent-composer-slot"));
}

const waitFrames = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 200)));

describe("TiptapComposer dictation", () => {
  it("starts dictation from the mic with no chooser", async () => {
    await act(async () => root.render(<Harness adapters={realtimeReady} />));

    const mic = slot<HTMLButtonElement>("voice-button");
    expect(mic?.getAttribute("aria-label")).toMatch(/^Dictate/);
    act(() => mic?.click());

    expect(voice.start).toHaveBeenCalledTimes(1);
    expect(realtime.start).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Use your voice");
    expect(document.body.textContent).not.toContain("Remember my preference");
  });

  it("shows a blocked microphone inline and keeps the mic usable", async () => {
    voice.state = "error";
    voice.errorMessage =
      "Microphone access is blocked. Click the site controls icon in the address bar, set Microphone to Allow for this app, then try again.";
    await act(async () => root.render(<Harness />));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Microphone access is blocked.");
    expect(alert?.className).toContain("--agent-kit-warning");
    expect(alert?.querySelector("svg.tabler-icon-alert-triangle")).not.toBe(
      null,
    );

    const mic = slot<HTMLButtonElement>("voice-button");
    expect(mic?.disabled).toBe(false);
    act(() => mic?.click());
    expect(voice.start).toHaveBeenCalledTimes(1);
  });

  it.each(["starting", "recording", "transcribing"] as const)(
    "grows the mic into the recording pill while %s, adding no row",
    async (state) => {
      await act(async () => root.render(<Harness />));
      const idleRows = composerRows();

      voice.state = state;
      await act(async () => root.render(<Harness />));

      expect(composerRows()).toEqual(idleRows);
      expect(trailing()).toEqual(["voice-recording", "send-button"]);
      expect(slot("voice-button")).toBeNull();
      const pill = slot("voice-recording")!;
      expect(pill.className).toContain(
        "h-[var(--agentkit-composer-toolbar-control-size,1.5rem)]",
      );
      expect(pill.className).toContain(
        "starting:w-[var(--agentkit-composer-toolbar-control-size,1.5rem)]",
      );
      const stop = pill.querySelector<HTMLButtonElement>(
        '[data-agent-composer-slot="voice-stop"]',
      );
      if (state === "transcribing") {
        expect(
          pill.querySelector('[role="status"]')?.getAttribute("aria-label"),
        ).toBe("Transcribing…");
        expect(stop?.getAttribute("aria-label")).toBe("Cancel transcription");
        expect(stop?.disabled).toBe(false);
        act(() => stop?.click());
        expect(voice.cancel).toHaveBeenCalledTimes(1);
        expect(voice.stop).not.toHaveBeenCalled();
      } else {
        expect(pill.querySelectorAll("[data-voice-waveform-bar]")).toHaveLength(
          9,
        );
        expect(stop?.getAttribute("aria-label")).toBe("Stop recording");
        expect(
          stop?.querySelector("svg.tabler-icon-player-stop-filled"),
        ).not.toBeNull();
      }
    },
  );

  it("collapses the pill back into the mic when dictation ends", async () => {
    voice.state = "recording";
    await act(async () => root.render(<Harness />));
    expect(slot("voice-recording")).not.toBeNull();

    voice.state = "idle";
    await act(async () => root.render(<Harness />));

    expect(slot("voice-recording")).toBeNull();
    expect(trailing()).toEqual(["voice-button", "send-button"]);
  });

  it("drives the waveform from the microphone level", async () => {
    voice.state = "recording";
    await act(async () => root.render(<Harness />));
    const bars = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-voice-waveform-bar]"),
      );
    expect(bars().at(-1)?.style.transform).toBe("scaleY(0.15)");

    voice.levels!.set({ input: 1, output: 0 });
    await waitFrames();

    expect(bars().at(-1)?.style.transform).toBe("scaleY(1)");
  });

  it("holds the waveform still under reduced motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    voice.state = "recording";
    await act(async () => root.render(<Harness />));

    voice.levels!.set({ input: 1, output: 0 });
    await waitFrames();

    const transforms = Array.from(
      container.querySelectorAll<HTMLElement>("[data-voice-waveform-bar]"),
      (bar) => bar.style.transform,
    );
    expect(new Set(transforms)).toEqual(new Set(["scaleY(0.4)"]));
  });

  it("stops from the pill and inserts the transcript into the draft", async () => {
    voice.state = "recording";
    await act(async () => root.render(<Harness />));

    act(() =>
      slot("voice-recording")
        ?.querySelector<HTMLButtonElement>(
          '[data-agent-composer-slot="voice-stop"]',
        )
        ?.click(),
    );
    expect(voice.stop).toHaveBeenCalledTimes(1);

    voice.state = "idle";
    await act(async () => {
      voice.options?.onTranscript("make the header blue");
      root.render(<Harness />);
    });

    expect(slot("editor")?.textContent).toContain("make the header blue");
  });

  it("cancels dictation on Escape without inserting anything", async () => {
    voice.state = "recording";
    await act(async () => root.render(<Harness />));

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(voice.cancel).toHaveBeenCalledTimes(1);
    expect(voice.stop).not.toHaveBeenCalled();
  });
});

describe("TiptapComposer primary slot", () => {
  const send = () => slot<HTMLButtonElement>("send-button");
  const stopButton = <button type="button">Stop run</button>;

  it("starts realtime voice chat from an empty composer when voice is ready", async () => {
    await act(async () => root.render(<Harness adapters={realtimeReady} />));

    expect(trailing()).toEqual(["voice-button", "send-button"]);
    expect(send()?.dataset.composerPrimary).toBe("voice-chat");
    expect(send()?.getAttribute("aria-label")).toBe("Start voice chat");
    expect(send()?.disabled).toBe(false);
    expect(send()?.querySelector("svg.tabler-icon-voice-chat")).not.toBeNull();

    act(() => send()?.click());

    expect(realtime.start).toHaveBeenCalledTimes(1);
    expect(voice.start).not.toHaveBeenCalled();
  });

  it("turns back into Send once the draft has text", async () => {
    await act(async () =>
      root.render(<Harness adapters={realtimeReady} initialText="Draft" />),
    );

    expect(send()?.dataset.composerPrimary).toBe("send");
    expect(send()?.querySelector("svg.tabler-icon-arrow-up")).not.toBeNull();
    expect(send()?.disabled).toBe(false);
    expect(trailing()).toEqual(["voice-button", "send-button"]);
  });

  it("does not offer voice chat while dictating", async () => {
    voice.state = "recording";
    await act(async () => root.render(<Harness adapters={realtimeReady} />));

    expect(trailing()).toEqual(["voice-recording", "send-button"]);
    expect(send()?.dataset.composerPrimary).toBe("send");
    expect(send()?.disabled).toBe(true);
  });

  it("keeps a dimmed Send when realtime voice is unavailable", async () => {
    await act(async () => root.render(<Harness />));

    expect(trailing()).toEqual(["voice-button", "send-button"]);
    expect(send()?.dataset.composerPrimary).toBe("send");
    expect(send()?.disabled).toBe(true);
    expect(send()?.className).toContain("disabled:opacity-30");
  });

  it("puts Stop in the primary slot while a run is active and the draft is empty", async () => {
    await act(async () =>
      root.render(<Harness adapters={realtimeReady} stopButton={stopButton} />),
    );

    expect(trailing()).toEqual(["voice-button", "stop-slot"]);
    expect(send()).toBeNull();
    expect(container.textContent).toContain("Stop run");
  });

  it("keeps Send last, after Stop, once a draft exists during a run", async () => {
    await act(async () =>
      root.render(
        <Harness
          adapters={realtimeReady}
          stopButton={stopButton}
          initialText="Draft"
        />,
      ),
    );

    expect(trailing()).toEqual(["voice-button", "stop-slot", "send-button"]);
    expect(send()?.dataset.composerPrimary).toBe("send");
  });

  it("keeps Send and the mic when voice chat is off", async () => {
    await act(async () =>
      root.render(
        <Harness adapters={realtimeReady} voiceChatEnabled={false} />,
      ),
    );

    expect(trailing()).toEqual(["voice-button", "send-button"]);
    expect(send()?.dataset.composerPrimary).toBe("send");
    expect(send()?.disabled).toBe(true);
    act(() => slot<HTMLButtonElement>("voice-button")?.click());
    expect(voice.start).toHaveBeenCalledTimes(1);
    expect(realtime.start).not.toHaveBeenCalled();
  });

  it("leaves another surface's live voice chat out of a composer with voice chat off", async () => {
    realtime.active = true;
    realtime.state = "listening";
    await act(async () =>
      root.render(
        <Harness adapters={realtimeReady} voiceChatEnabled={false} />,
      ),
    );

    expect(trailing()).toEqual(["voice-button", "send-button"]);
    expect(send()?.dataset.composerPrimary).toBe("send");
  });

  it("offers only a dimmed Send when voice is off", async () => {
    await act(async () =>
      root.render(<Harness adapters={realtimeReady} voiceEnabled={false} />),
    );

    expect(trailing()).toEqual(["send-button"]);
    expect(send()?.dataset.composerPrimary).toBe("send");
    expect(send()?.disabled).toBe(true);
  });
});

describe("TiptapComposer voice chat", () => {
  const activate = (state: string) => {
    realtime.active = true;
    realtime.state = state;
  };

  it("holds voice chat in the composer: status and mutes in the mic slot, X in the primary slot", async () => {
    activate("listening");
    await act(async () => root.render(<Harness adapters={realtimeReady} />));

    expect(trailing()).toEqual([
      "voice-chat-status",
      "voice-chat-speaker",
      "voice-chat-microphone",
      "send-button",
    ]);
    expect(slot("voice-button")).toBeNull();
    expect(slot("voice-chat-settings")).toBeNull();
    const end = slot<HTMLButtonElement>("send-button")!;
    expect(end.dataset.composerPrimary).toBe("end-voice-chat");
    expect(end.getAttribute("aria-label")).toBe("End voice chat");

    act(() => slot<HTMLButtonElement>("voice-chat-microphone")!.click());
    expect(realtime.setInputMuted).toHaveBeenCalledWith(true);
    act(() => end.click());
    expect(realtime.end).toHaveBeenCalledTimes(1);
  });

  it("renders no floating dock", async () => {
    activate("speaking");
    await act(async () => root.render(<Harness adapters={realtimeReady} />));

    expect(document.querySelector("[data-realtime-voice-state]")).toBeNull();
    expect(
      document.querySelector('[data-realtime-voice-chat-toggle="orb"]'),
    ).toBeNull();
  });

  it("locks the editor behind a listening placeholder", async () => {
    activate("listening");
    await act(async () => root.render(<Harness />));

    const editor = container.querySelector<HTMLElement>(".ProseMirror");
    expect(editor?.getAttribute("contenteditable")).toBe("false");
    expect(editor?.getAttribute("aria-disabled")).toBe("true");
    expect(
      editor
        ?.querySelector("[data-placeholder]")
        ?.getAttribute("data-placeholder"),
    ).toBe("Listening…");
  });

  it("does not start dictation from the shortcut during voice chat", async () => {
    activate("listening");
    await act(async () => root.render(<Harness />));

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "m",
          metaKey: true,
          shiftKey: true,
        }),
      );
    });
    expect(voice.start).not.toHaveBeenCalled();
  });

  it("shows a failed session as an amber composer notice with a retry", async () => {
    activate("error");
    realtime.errorMessage = "The realtime voice connection failed.";
    await act(async () => root.render(<Harness />));

    const notice = container.querySelector<HTMLElement>(
      '[data-notice="voice-chat"]',
    );
    expect(notice?.textContent).toContain(
      "The realtime voice connection failed.",
    );
    expect(notice?.dataset.tone).toBe("warning");
    expect(slot("voice-chat-status")).toBeNull();

    const retry = Array.from(notice!.querySelectorAll("button")).find(
      (button) => button.textContent === "Try again",
    );
    act(() => retry?.click());
    expect(realtime.dismissError).toHaveBeenCalledTimes(1);
    expect(realtime.start).toHaveBeenCalledTimes(1);
  });
});
