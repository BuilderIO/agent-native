// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../ui/tooltip.js";
import { createRealtimeVoiceAudioLevelStore } from "./realtime-voice-audio-level.js";
import {
  RealtimeVoiceModeDock,
  RealtimeVoiceModeEntry,
  type RealtimeVoiceModeCopy,
} from "./RealtimeVoiceMode.js";

const copy: RealtimeVoiceModeCopy = {
  entryButtonLabel: "Use microphone",
  promptTitle: "Use your voice",
  promptDescription:
    "Voice mode keeps listening while the agent navigates and takes actions.",
  setupTitle: "Set up voice mode",
  setupDescription:
    "Connect Builder.io to use managed voice with free credits, or add your own keys.",
  connectBuilder: "Connect Builder.io",
  useOpenAiKey: "Add your own keys",
  startWithOpenAiKey: "Start with OpenAI key",
  startVoiceMode: "Real-time voice",
  keepDictating: "Dictate",
  rememberPreference: "Remember my preference",
  showChat: "Show chat",
  hideChat: "Hide chat",
  endVoiceMode: "End voice mode",
  voiceSettings: "Voice settings",
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
  let animate: ReturnType<typeof vi.fn>;
  let cancelGlowAnimation: ReturnType<typeof vi.fn>;
  let updateGlowPlaybackRate: ReturnType<typeof vi.fn>;
  let originalAnimate: typeof HTMLElement.prototype.animate | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    originalAnimate = HTMLElement.prototype.animate;
    cancelGlowAnimation = vi.fn();
    updateGlowPlaybackRate = vi.fn();
    animate = vi.fn(
      () =>
        ({
          cancel: cancelGlowAnimation,
          playbackRate: 1,
          updatePlaybackRate: updateGlowPlaybackRate,
        }) as unknown as Animation,
    );
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (originalAnimate) {
      Object.defineProperty(HTMLElement.prototype, "animate", {
        configurable: true,
        value: originalAnimate,
      });
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
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

    expect(document.body.textContent).toContain("Use your voice");
    const prompt = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(prompt?.className).toContain(
      "w-[min(calc(100vw-2rem),var(--radix-popover-content-available-width,18rem),18rem)]",
    );
    expect(document.body.textContent).not.toContain(
      "Voice mode keeps listening while the agent navigates and takes actions.",
    );
    expect(document.body.textContent).toContain("Dictate");
    expect(document.body.textContent).toContain("Remember my preference");
    expect(onStartVoiceMode).not.toHaveBeenCalled();
    expect(onKeepDictating).not.toHaveBeenCalled();

    const startVoiceMode = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Real-time voice"));
    act(() => startVoiceMode?.click());

    expect(onStartVoiceMode).toHaveBeenCalledOnce();
    expect(onKeepDictating).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Use your voice");
  });

  it("does not start realtime voice while provider readiness is unresolved", () => {
    const onStartVoiceMode = vi.fn();
    const onKeepDictating = vi.fn();

    render(
      <RealtimeVoiceModeEntry
        copy={copy}
        open
        providerStatusPending
        onStartVoiceMode={onStartVoiceMode}
        onKeepDictating={onKeepDictating}
      />,
    );

    const startVoiceMode = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Real-time voice"));
    expect(startVoiceMode?.disabled).toBe(true);
    act(() => startVoiceMode?.click());
    expect(onStartVoiceMode).not.toHaveBeenCalled();

    const keepDictating = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Dictate");
    expect(keepDictating?.disabled).toBe(false);
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
    ).find((button) => button.textContent === "Dictate");
    act(() => keepDictating?.click());

    expect(onKeepDictating).toHaveBeenCalledOnce();
    expect(onStartVoiceMode).not.toHaveBeenCalled();
  });

  it("remembers the selected input mode only when requested", () => {
    const onStartVoiceMode = vi.fn();
    const onRememberPreference = vi.fn();

    render(
      <RealtimeVoiceModeEntry
        copy={copy}
        open
        onStartVoiceMode={onStartVoiceMode}
        onKeepDictating={vi.fn()}
        onRememberPreference={onRememberPreference}
      />,
    );

    const remember = document.querySelector<HTMLElement>('[role="checkbox"]');
    act(() => remember?.click());
    const realtime = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Real-time voice"));
    act(() => realtime?.click());

    expect(onRememberPreference).toHaveBeenCalledWith("realtime");
    expect(onStartVoiceMode).toHaveBeenCalledOnce();
  });

  it("bypasses the chooser for a remembered input mode", () => {
    const onStartVoiceMode = vi.fn();
    const onKeepDictating = vi.fn();

    render(
      <RealtimeVoiceModeEntry
        copy={copy}
        preferredMode="dictation"
        onStartVoiceMode={onStartVoiceMode}
        onKeepDictating={onKeepDictating}
      />,
    );

    const microphone = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Use microphone"]',
    );
    act(() => microphone?.click());

    expect(onKeepDictating).toHaveBeenCalledOnce();
    expect(onStartVoiceMode).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Use your voice");
  });

  it("shows setup instead of starting a remembered realtime mode without a provider", () => {
    const onStartVoiceMode = vi.fn();

    render(
      <RealtimeVoiceModeEntry
        copy={copy}
        setupRequired
        preferredMode="realtime"
        onStartVoiceMode={onStartVoiceMode}
        onKeepDictating={vi.fn()}
      />,
    );

    const microphone = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Use microphone"]',
    );
    act(() => microphone?.click());

    expect(onStartVoiceMode).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Set up voice mode");
  });

  it("makes Builder the primary setup action and own keys the secondary", () => {
    const onConnectBuilder = vi.fn();
    const onUseOpenAiKey = vi.fn();

    render(
      <div className="agent-panel-root">
        <RealtimeVoiceModeEntry
          copy={copy}
          open
          setupRequired
          onStartVoiceMode={vi.fn()}
          onKeepDictating={vi.fn()}
          onConnectBuilder={onConnectBuilder}
          onUseOpenAiKey={onUseOpenAiKey}
        />
      </div>,
    );

    expect(document.body.textContent).toContain("Set up voice mode");
    const prompt = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(prompt?.className).toContain(
      "w-[min(calc(100vw-2rem),var(--radix-popover-content-available-width,24rem),24rem)]",
    );
    expect(prompt?.dataset.collisionBoundary).toBe("agent-panel");
    const actions = Array.from(prompt?.querySelectorAll("div") ?? []).find(
      (element) => element.className.includes("bg-muted/30"),
    );
    const actionClasses = actions?.className.split(/\s+/) ?? [];
    expect(actionClasses).toContain("grid");
    expect(actionClasses).toContain("rounded-lg");
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    );
    expect(
      buttons.find((button) => button.textContent === "Connect Builder.io"),
    ).toBeDefined();
    act(() =>
      buttons
        .find((button) => button.textContent === "Connect Builder.io")
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

    const status = document.querySelector('[role="status"]');
    expect(status?.textContent).toBe("Listening");
    expect(status?.className).toContain("sr-only");
    const toggleChat = document.querySelector<HTMLButtonElement>(
      'button[data-realtime-voice-chat-toggle="orb"]',
    );
    expect(
      document.querySelector(
        'button[data-realtime-voice-chat-toggle="controls"]',
      ),
    ).toBeNull();
    expect(toggleChat?.getAttribute("aria-pressed")).toBe("false");
    expect(toggleChat?.getAttribute("aria-expanded")).toBe("false");
    expect(toggleChat?.className).toContain("backdrop-blur-xl");
    expect(toggleChat?.className).not.toContain("shadow-lg");
    expect(toggleChat?.querySelector(".blur-md")).toBeNull();
    expect(document.querySelector('[class*="bg-gradient"]')).toBeNull();
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

  it("progressively discloses the end-session control", () => {
    const onEndVoiceMode = vi.fn();

    render(
      <RealtimeVoiceModeDock
        state="listening"
        copy={copy}
        chatVisible={false}
        onToggleChat={vi.fn()}
        onEndVoiceMode={onEndVoiceMode}
      />,
    );

    const endVoiceMode = document.querySelector<HTMLButtonElement>(
      'button[aria-label="End voice mode"]',
    );

    act(() => endVoiceMode?.click());
    expect(onEndVoiceMode).toHaveBeenCalledOnce();
  });

  it("opens compact voice settings without leaving or ending the session", () => {
    const onLanguageChange = vi.fn();
    const onIntelligenceChange = vi.fn();
    const onVoiceChange = vi.fn();

    render(
      <RealtimeVoiceModeDock
        state="listening"
        copy={copy}
        chatVisible={false}
        onToggleChat={vi.fn()}
        onEndVoiceMode={vi.fn()}
        settings={{
          dialogLabel: "Voice settings",
          appliesNextConversationNote:
            "Voice changes apply to the next conversation.",
          microphone: {
            label: "Microphone",
            value: "default",
            options: [
              { value: "default", label: "System default" },
              { value: "studio", label: "Studio microphone" },
            ],
            onValueChange: vi.fn(),
          },
          language: {
            label: "Language",
            value: "en",
            options: [
              { value: "auto", label: "Auto" },
              { value: "en", label: "English" },
            ],
            onValueChange: onLanguageChange,
          },
          intelligence: {
            label: "Intelligence",
            value: "instant",
            options: [
              { value: "instant", label: "Instant" },
              { value: "balanced", label: "Balanced" },
            ],
            onValueChange: onIntelligenceChange,
          },
          voiceStyle: {
            label: "Voice style",
            value: "marin",
            options: [
              {
                value: "marin",
                label: "Marin",
                description: "Warm and conversational",
              },
              { value: "cedar", label: "Cedar" },
            ],
            onValueChange: onVoiceChange,
          },
        }}
      />,
    );

    const settingsButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Voice settings"]',
    );
    act(() => settingsButton?.click());

    expect(settingsButton?.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.querySelector('[data-realtime-voice-settings="true"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("Warm and conversational");
    expect(document.body.textContent).toContain(
      "Voice changes apply to the next conversation.",
    );
    expect(
      Array.from(document.querySelectorAll('[role="combobox"]')).map(
        (element) => element.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Microphone: System default",
      "Language: English",
      "Intelligence: Instant",
      "Voice style: Marin",
    ]);
    expect(document.activeElement).not.toBe(
      document.querySelector('[role="combobox"]'),
    );

    const language = document.querySelector<HTMLElement>(
      '[role="combobox"][aria-label="Language: English"]',
    );
    expect(language?.className).toContain("focus-visible:ring-2");
    act(() => {
      language?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });
    const auto = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent?.includes("Auto"));
    expect(auto).toBeDefined();
    const settingsPanel = document.querySelector<HTMLElement>(
      '[data-realtime-voice-settings="true"]',
    );
    act(() => {
      settingsPanel?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      settingsPanel?.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });
    expect(settingsButton?.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.querySelector('[data-realtime-voice-settings="true"]'),
    ).not.toBeNull();

    act(() => {
      language?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });
    const reopenedAuto = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent?.includes("Auto"));
    expect(reopenedAuto).toBeDefined();
    act(() => {
      reopenedAuto?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      reopenedAuto?.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });

    expect(onLanguageChange).toHaveBeenCalledWith("auto");
    expect(onIntelligenceChange).not.toHaveBeenCalled();
    expect(onVoiceChange).not.toHaveBeenCalled();
    expect(settingsButton?.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.querySelector('[data-realtime-voice-settings="true"]'),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-realtime-voice-state]"),
    ).not.toBeNull();

    act(() => settingsButton?.click());
    expect(settingsButton?.getAttribute("aria-expanded")).toBe("false");
    expect(
      document.querySelector('[data-realtime-voice-settings="true"]'),
    ).toBeNull();

    act(() => settingsButton?.click());
    expect(settingsButton?.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.querySelector('[data-realtime-voice-settings="true"]'),
    ).not.toBeNull();
  });

  it("keeps the dock visible when chat opens itself", () => {
    const sidebar = document.createElement("div");
    let sidebarWidth = 320;
    sidebar.className = "agent-sidebar-panel";
    sidebar.dataset.agentSidebarPosition = "right";
    sidebar.dataset.agentSidebarState = "open";
    sidebar.getBoundingClientRect = () =>
      ({
        bottom: 768,
        height: 768,
        left: 1024 - sidebarWidth,
        right: 1024,
        top: 0,
        width: sidebarWidth,
        x: 1024 - sidebarWidth,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(sidebar);

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
        .querySelector("[data-realtime-voice-state]")
        ?.getAttribute("data-realtime-voice-chat-offset"),
    ).toBe("-320");

    act(() => {
      sidebarWidth = 400;
      window.dispatchEvent(new Event("resize"));
    });
    expect(
      document
        .querySelector("[data-realtime-voice-state]")
        ?.getAttribute("data-realtime-voice-chat-offset"),
    ).toBe("-400");
    expect(
      document
        .querySelector('button[aria-label="Hide chat"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    sidebar.remove();
  });

  it("keeps the dock reachable for fullscreen and left-side chat", () => {
    const sidebar = document.createElement("div");
    sidebar.className = "agent-sidebar-panel";
    sidebar.dataset.agentSidebarPosition = "right";
    sidebar.dataset.agentSidebarState = "open";
    sidebar.dataset.agentSidebarLayout = "fullscreen";
    sidebar.getBoundingClientRect = () =>
      ({
        bottom: 768,
        height: 768,
        left: 0,
        right: 1024,
        top: 0,
        width: 1024,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(sidebar);

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
      document
        .querySelector("[data-realtime-voice-state]")
        ?.getAttribute("data-realtime-voice-chat-offset"),
    ).toBe("0");

    act(() => {
      document.documentElement.style.direction = "rtl";
      sidebar.dataset.agentSidebarLayout = "desktop";
      sidebar.dataset.agentSidebarPosition = "left";
      sidebar.getBoundingClientRect = () =>
        ({
          bottom: 768,
          height: 768,
          left: 0,
          right: 280,
          top: 0,
          width: 280,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    });
    render(
      <RealtimeVoiceModeDock
        key="rtl"
        state="listening"
        copy={copy}
        chatVisible
        onToggleChat={vi.fn()}
        onEndVoiceMode={vi.fn()}
      />,
    );
    expect(
      document
        .querySelector("[data-realtime-voice-state]")
        ?.getAttribute("data-realtime-voice-chat-offset"),
    ).toBe("280");

    document.documentElement.style.direction = "";
    sidebar.remove();
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
    const centerBar = document.querySelectorAll<HTMLElement>(
      '[data-realtime-voice-waveform="true"] > span',
    )[2];
    expect(centerBar?.style.transform).toBe("scaleY(0.76)");

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

  it.each(["listening", "speaking", "working", "ending"] as const)(
    "keeps the waveform visible while voice mode is %s and silent",
    (state) => {
      render(
        <RealtimeVoiceModeDock
          state={state}
          copy={copy}
          chatVisible={false}
          onToggleChat={vi.fn()}
          onEndVoiceMode={vi.fn()}
        />,
      );

      expect(
        document.querySelector(
          '[data-realtime-voice-waveform-activity="idle"]',
        ),
      ).not.toBeNull();
      expect(document.querySelector(".animate-spin")).toBeNull();
    },
  );

  it.each(["listening", "speaking"] as const)(
    "keeps a soft session glow while %s",
    (state) => {
      render(
        <RealtimeVoiceModeDock
          state={state}
          copy={copy}
          chatVisible={false}
          onToggleChat={vi.fn()}
          onEndVoiceMode={vi.fn()}
        />,
      );
      expect(
        document.querySelector(".agent-realtime-voice-glow"),
      ).not.toBeNull();
      expect(
        document.querySelector(".agent-realtime-voice-working"),
      ).toBeNull();
    },
  );

  it("brightens the live glow while working", () => {
    render(
      <RealtimeVoiceModeDock
        state="working"
        copy={copy}
        chatVisible={false}
        onToggleChat={vi.fn()}
        onEndVoiceMode={vi.fn()}
      />,
    );
    expect(document.querySelector(".agent-realtime-voice-glow")).not.toBeNull();
    expect(
      document.querySelector(".agent-realtime-voice-working"),
    ).not.toBeNull();
  });

  it("changes glow speed without restarting or jumping its rotation", () => {
    render(
      <RealtimeVoiceModeDock
        state="listening"
        copy={copy}
        chatVisible={false}
        onToggleChat={vi.fn()}
        onEndVoiceMode={vi.fn()}
      />,
    );
    const glow = document.querySelector('[data-realtime-voice-glow="true"]');

    expect(animate).toHaveBeenCalledTimes(1);
    expect(updateGlowPlaybackRate).toHaveBeenLastCalledWith(1);

    render(
      <RealtimeVoiceModeDock
        state="working"
        copy={copy}
        chatVisible={false}
        onToggleChat={vi.fn()}
        onEndVoiceMode={vi.fn()}
      />,
    );

    expect(document.querySelector('[data-realtime-voice-glow="true"]')).toBe(
      glow,
    );
    expect(animate).toHaveBeenCalledTimes(1);
    expect(cancelGlowAnimation).not.toHaveBeenCalled();
    expect(updateGlowPlaybackRate).toHaveBeenLastCalledWith(2.4);

    render(
      <RealtimeVoiceModeDock
        state="speaking"
        copy={copy}
        chatVisible={false}
        onToggleChat={vi.fn()}
        onEndVoiceMode={vi.fn()}
      />,
    );

    expect(animate).toHaveBeenCalledTimes(1);
    expect(cancelGlowAnimation).not.toHaveBeenCalled();
    expect(updateGlowPlaybackRate).toHaveBeenLastCalledWith(1);
  });

  it.each(["connecting", "error", "ending"] as const)(
    "does not show the live glow while %s",
    (state) => {
      render(
        <RealtimeVoiceModeDock
          state={state}
          copy={copy}
          chatVisible={false}
          onToggleChat={vi.fn()}
          onEndVoiceMode={vi.fn()}
        />,
      );
      expect(document.querySelector(".agent-realtime-voice-glow")).toBeNull();
      expect(
        document.querySelector(".agent-realtime-voice-working"),
      ).toBeNull();
    },
  );

  it("shows an unmistakable loader and ignores early audio until connected", () => {
    const audioLevels = createRealtimeVoiceAudioLevelStore();
    audioLevels.set({ input: 0.8, output: 0 });

    render(
      <RealtimeVoiceModeDock
        state="connecting"
        copy={copy}
        chatVisible={false}
        audioLevels={audioLevels}
        onToggleChat={vi.fn()}
        onEndVoiceMode={vi.fn()}
      />,
    );

    expect(
      document
        .querySelector("[data-realtime-voice-state]")
        ?.getAttribute("data-realtime-voice-activity"),
    ).toBe("idle");
    expect(
      document.querySelector('[data-realtime-voice-waveform="true"]'),
    ).toBeNull();
    expect(
      document.querySelector(
        '[data-realtime-voice-connecting-indicator="true"]',
      ),
    ).not.toBeNull();
    expect(document.querySelector(".animate-spin")).not.toBeNull();
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
    const status = document.querySelector('[role="status"]');
    expect(status?.textContent).toBe("Ending voice mode");
    expect(status?.className).toContain("sr-only");
  });
});
