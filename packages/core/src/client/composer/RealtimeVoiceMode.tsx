import { Button } from "@agent-native/toolkit/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@agent-native/toolkit/ui/select";
import {
  IconAlertTriangle,
  IconBrain,
  IconLanguage,
  IconLoader2,
  IconMicrophone,
  IconPhoneOff,
  IconSettings,
  IconVolume,
} from "@tabler/icons-react";
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { cn } from "../utils.js";
import {
  createRealtimeVoiceAudioLevelStore,
  type RealtimeVoiceAudioLevelStore,
} from "./realtime-voice-audio-level.js";

export type RealtimeVoiceModeState =
  | "connecting"
  | "listening"
  | "speaking"
  | "working"
  | "error"
  | "ending";

/**
 * User-visible copy stays outside the shared component so host catalogs remain
 * the source of truth. Callers should provide these values through `useT()`.
 */
export interface RealtimeVoiceModeCopy {
  entryButtonLabel: string;
  promptTitle: string;
  promptDescription: string;
  setupTitle: string;
  setupDescription: string;
  connectBuilder: string;
  useOpenAiKey: string;
  startWithOpenAiKey: string;
  startVoiceMode: string;
  keepDictating: string;
  showChat: string;
  hideChat: string;
  endVoiceMode: string;
  voiceSettings: string;
  settings: {
    microphone: string;
    defaultMicrophone: string;
    microphoneSwitchFailed: string;
    language: string;
    autoLanguage: string;
    languages: Record<
      Exclude<
        import("./useRealtimeVoiceMode.js").RealtimeVoiceLanguage,
        "auto"
      >,
      string
    >;
    intelligence: string;
    intelligenceLevels: Record<
      import("./useRealtimeVoiceMode.js").RealtimeVoiceIntelligence,
      string
    >;
    voiceStyle: string;
    voiceChangePending: string;
    voiceDescriptions: Record<
      import("./useRealtimeVoiceMode.js").RealtimeVoice,
      string
    >;
  };
  status: Record<RealtimeVoiceModeState, string>;
  errors: {
    unsupported: string;
    responseFailed: string;
    sessionFailed: string;
    channelDisconnected: string;
    connectionTimedOut?: string;
    connectionFailed: string;
    offerFailed: string;
  };
}

export interface RealtimeVoiceModeEntryProps {
  copy: RealtimeVoiceModeCopy;
  disabled?: boolean;
  providerStatusPending?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onStartVoiceMode: () => void;
  onKeepDictating: () => void;
  setupRequired?: boolean;
  openAiConfigured?: boolean;
  connectingBuilder?: boolean;
  onConnectBuilder?: () => void;
  onUseOpenAiKey?: () => void;
  className?: string;
}

/**
 * Composer mic entry point for apps that support a full-duplex voice session.
 * The first click offers voice mode without silently changing the existing
 * editable-dictation behavior.
 */
export function RealtimeVoiceModeEntry({
  copy,
  disabled,
  providerStatusPending = false,
  open: controlledOpen,
  onOpenChange,
  onStartVoiceMode,
  onKeepDictating,
  setupRequired = false,
  openAiConfigured = false,
  connectingBuilder = false,
  onConnectBuilder,
  onUseOpenAiKey,
  className,
}: RealtimeVoiceModeEntryProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const titleId = useId();
  const descriptionId = useId();
  const [collisionBoundary, setCollisionBoundary] =
    useState<HTMLElement | null>(null);

  const setTriggerNode = useCallback((node: HTMLButtonElement | null) => {
    const nextBoundary =
      node?.closest<HTMLElement>(".agent-panel-root") ?? null;
    setCollisionBoundary((currentBoundary) =>
      currentBoundary === nextBoundary ? currentBoundary : nextBoundary,
    );
  }, []);

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const choose = (callback: () => void) => {
    setOpen(false);
    callback();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              ref={setTriggerNode}
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={copy.entryButtonLabel}
              aria-expanded={open}
              className={cn(
                "size-7 shrink-0 text-muted-foreground hover:text-foreground",
                className,
              )}
            >
              <IconMicrophone />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{copy.entryButtonLabel}</TooltipContent>
      </Tooltip>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        collisionBoundary={collisionBoundary ?? undefined}
        collisionPadding={16}
        data-collision-boundary={collisionBoundary ? "agent-panel" : "viewport"}
        className={cn(
          "p-4",
          setupRequired
            ? "w-[min(calc(100vw-2rem),var(--radix-popover-content-available-width,30rem),30rem)]"
            : "w-[min(calc(100vw-2rem),var(--radix-popover-content-available-width,22rem),22rem)]",
        )}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="grid gap-3">
          <div className="grid gap-1">
            <h2 id={titleId} className="text-sm font-semibold text-foreground">
              {setupRequired ? copy.setupTitle : copy.promptTitle}
            </h2>
            <p
              id={descriptionId}
              className="text-sm leading-relaxed text-muted-foreground"
            >
              {setupRequired ? copy.setupDescription : copy.promptDescription}
            </p>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => choose(onKeepDictating)}
            >
              {copy.keepDictating}
            </Button>
            {setupRequired ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => choose(onUseOpenAiKey ?? onStartVoiceMode)}
                >
                  {openAiConfigured
                    ? copy.startWithOpenAiKey
                    : copy.useOpenAiKey}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="whitespace-nowrap"
                  disabled={connectingBuilder}
                  onClick={() => choose(onConnectBuilder ?? onStartVoiceMode)}
                >
                  {connectingBuilder ? (
                    <IconLoader2 className="animate-spin" />
                  ) : null}
                  {copy.connectBuilder}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={providerStatusPending}
                onClick={() => choose(onStartVoiceMode)}
              >
                {providerStatusPending ? (
                  <IconLoader2 className="animate-spin" />
                ) : (
                  <IconMicrophone />
                )}
                {copy.startVoiceMode}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface RealtimeVoiceModeDockProps {
  state: RealtimeVoiceModeState;
  copy: RealtimeVoiceModeCopy;
  chatVisible: boolean;
  audioLevels?: RealtimeVoiceAudioLevelStore;
  onToggleChat: () => void;
  onEndVoiceMode: () => void;
  settings?: RealtimeVoiceModeInlineSettings;
  errorMessage?: string | null;
  className?: string;
}

export interface RealtimeVoiceModeSettingOption {
  value: string;
  label: string;
  description?: string;
}

export interface RealtimeVoiceModeSelectSetting {
  label: string;
  value: string;
  options: readonly RealtimeVoiceModeSettingOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

export interface RealtimeVoiceModeInlineSettings {
  dialogLabel: string;
  appliesNextConversationNote?: string;
  microphoneError?: string;
  microphone: RealtimeVoiceModeSelectSetting;
  language: RealtimeVoiceModeSelectSetting;
  intelligence: RealtimeVoiceModeSelectSetting;
  voiceStyle: RealtimeVoiceModeSelectSetting;
}

const SILENT_AUDIO_LEVELS = createRealtimeVoiceAudioLevelStore();
const WAVEFORM_WEIGHTS = [0.55, 0.82, 1, 0.82, 0.55];
const AUDIO_ACTIVITY_THRESHOLD = 0.035;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

function VoiceWaveform({
  level,
  reducedMotion,
  activity,
}: {
  level: number;
  reducedMotion: boolean;
  activity: "idle" | "user" | "assistant";
}) {
  const visibleLevel = reducedMotion ? 0.45 : level;
  return (
    <span
      aria-hidden="true"
      className="flex h-6 items-center justify-center gap-0.5"
      data-realtime-voice-waveform="true"
      data-realtime-voice-waveform-activity={activity}
    >
      {WAVEFORM_WEIGHTS.map((weight, index) => (
        <span
          key={index}
          className="h-5 w-0.5 origin-center rounded-full bg-current transition-transform duration-75 ease-out motion-reduce:transition-none"
          style={{
            transform: `scaleY(${0.2 + visibleLevel * 0.8 * weight})`,
          }}
        />
      ))}
    </span>
  );
}

function VoiceConnectingIndicator() {
  return (
    <IconLoader2
      aria-hidden="true"
      className="size-6 animate-spin motion-reduce:animate-none"
      data-realtime-voice-connecting-indicator="true"
    />
  );
}

const ORB_STATE_CLASSES: Record<RealtimeVoiceModeState, string> = {
  connecting:
    "bg-background/65 text-foreground ring-border/60 hover:bg-background/75",
  listening:
    "bg-background/65 text-foreground ring-border/60 hover:bg-background/75",
  speaking:
    "bg-background/65 text-foreground ring-border/60 hover:bg-background/75",
  working:
    "bg-background/65 text-foreground ring-border/60 hover:bg-background/75",
  error:
    "bg-destructive/20 text-destructive ring-destructive/30 hover:bg-destructive/25",
  ending: "cursor-wait bg-background/65 text-muted-foreground ring-border/60",
};

function useChatPanelTranslation(chatVisible: boolean): number {
  const [translation, setTranslation] = useState(0);

  useEffect(() => {
    if (!chatVisible || typeof window === "undefined") {
      setTranslation(0);
      return;
    }

    const direction = window.getComputedStyle(
      document.documentElement,
    ).direction;
    const inlineEnd = direction === "rtl" ? "left" : "right";

    const update = () => {
      const panels = Array.from(
        document.querySelectorAll<HTMLElement>(
          `.agent-sidebar-panel[data-agent-sidebar-position="${inlineEnd}"][data-agent-sidebar-state="open"]`,
        ),
      );
      const panel = panels.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      if (!panel) {
        setTranslation(0);
        return;
      }

      // A fullscreen chat has no unobscured side to move into. Keep the dock
      // at its normal edge so it stays reachable instead of pinning it to the
      // opposite side of the same overlay.
      if (panel.dataset.agentSidebarLayout === "fullscreen") {
        setTranslation(0);
        return;
      }

      const rect = panel.getBoundingClientRect();
      const overlap =
        inlineEnd === "right"
          ? Math.max(0, window.innerWidth - rect.left)
          : Math.max(0, rect.right);
      const maximumShift = Math.max(0, window.innerWidth - 96);
      const distance = Math.min(overlap, maximumShift);
      setTranslation(inlineEnd === "right" ? -distance : distance);
    };

    update();
    const frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    const observedPanels = new WeakSet<HTMLElement>();
    const observePanels = () => {
      document
        .querySelectorAll<HTMLElement>(".agent-sidebar-panel")
        .forEach((panel) => {
          if (!observedPanels.has(panel)) {
            observedPanels.add(panel);
            resizeObserver?.observe(panel);
          }
        });
    };
    observePanels();

    const mutationObserver = new MutationObserver(() => {
      observePanels();
      update();
    });
    mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: [
        "data-agent-sidebar-layout",
        "data-agent-sidebar-state",
        "style",
      ],
      childList: true,
      subtree: true,
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
    };
  }, [chatVisible]);

  return translation;
}

function VoiceSettingRow({
  icon: Icon,
  setting,
  onSelectOpenChange,
}: {
  icon: typeof IconLanguage;
  setting: RealtimeVoiceModeSelectSetting;
  onSelectOpenChange: (open: boolean) => void;
}) {
  const selected = setting.options.find(
    (option) => option.value === setting.value,
  );

  return (
    <Select
      value={setting.value}
      onValueChange={setting.onValueChange}
      onOpenChange={onSelectOpenChange}
      disabled={setting.disabled}
    >
      <SelectTrigger
        aria-label={`${setting.label}: ${selected?.label ?? setting.value}`}
        className="h-11 rounded-none border-0 bg-transparent px-3 shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-sm font-medium text-foreground">
            {setting.label}
          </span>
          <span className="ms-auto min-w-0 truncate text-end text-sm text-muted-foreground">
            {selected?.label ?? setting.value}
          </span>
        </div>
      </SelectTrigger>
      <SelectContent
        align="end"
        className="min-w-56"
        data-realtime-voice-setting-options="true"
      >
        <SelectGroup>
          {setting.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="grid gap-0.5">
                <span>{option.label}</span>
                {option.description ? (
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function VoiceInlineSettings({
  settings,
  disabled,
  onSelectOpenChange,
}: {
  settings: RealtimeVoiceModeInlineSettings;
  disabled: boolean;
  onSelectOpenChange: (open: boolean) => void;
}) {
  const selectedVoice = settings.voiceStyle.options.find(
    (option) => option.value === settings.voiceStyle.value,
  );

  return (
    <div data-realtime-voice-settings="true">
      <h2 className="sr-only">{settings.dialogLabel}</h2>
      <div className="grid gap-0.5 px-4 pb-3 pt-4 text-center">
        <div className="truncate text-base font-semibold text-foreground">
          {selectedVoice?.label ?? settings.voiceStyle.value}
        </div>
        {selectedVoice?.description ? (
          <div className="truncate text-xs text-muted-foreground">
            {selectedVoice.description}
          </div>
        ) : null}
      </div>
      <div className="mx-2 mb-2 overflow-hidden rounded-xl border border-border/70 bg-background/70">
        <VoiceSettingRow
          icon={IconMicrophone}
          setting={{
            ...settings.microphone,
            disabled: disabled || settings.microphone.disabled,
          }}
          onSelectOpenChange={onSelectOpenChange}
        />
        <div className="mx-3 h-px bg-border/70" />
        <VoiceSettingRow
          icon={IconLanguage}
          setting={{
            ...settings.language,
            disabled: disabled || settings.language.disabled,
          }}
          onSelectOpenChange={onSelectOpenChange}
        />
        <div className="mx-3 h-px bg-border/70" />
        <VoiceSettingRow
          icon={IconBrain}
          setting={{
            ...settings.intelligence,
            disabled: disabled || settings.intelligence.disabled,
          }}
          onSelectOpenChange={onSelectOpenChange}
        />
        <div className="mx-3 h-px bg-border/70" />
        <VoiceSettingRow
          icon={IconVolume}
          setting={{
            ...settings.voiceStyle,
            disabled: disabled || settings.voiceStyle.disabled,
          }}
          onSelectOpenChange={onSelectOpenChange}
        />
      </div>
      {settings.microphoneError ? (
        <p className="px-4 pb-3 text-center text-xs text-destructive">
          {settings.microphoneError}
        </p>
      ) : null}
      {settings.appliesNextConversationNote ? (
        <p className="px-4 pb-3 text-center text-xs text-muted-foreground">
          {settings.appliesNextConversationNote}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Persistent voice-session control. Toggling the main orb only changes chat
 * visibility; ending the realtime session is intentionally a separate action.
 */
export function RealtimeVoiceModeDock({
  state,
  copy,
  chatVisible,
  audioLevels = SILENT_AUDIO_LEVELS,
  onToggleChat,
  onEndVoiceMode,
  settings,
  errorMessage,
  className,
}: RealtimeVoiceModeDockProps) {
  const statusId = useId();
  const controlsId = useId();
  const [controlsOpen, setControlsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectInteractionRef = useRef(false);
  const selectInteractionFrameRef = useRef<number | null>(null);
  const levels = useSyncExternalStore(
    audioLevels.subscribe,
    audioLevels.getSnapshot,
    audioLevels.getSnapshot,
  );
  const reducedMotion = usePrefersReducedMotion();
  // Microphone metering begins while the SDP request is still in flight. Keep
  // the connecting affordance authoritative until WebRTC is established;
  // otherwise speaking into the mic replaces the loader with a waveform and
  // makes a stalled connection look like a live call.
  const connected =
    state === "listening" || state === "speaking" || state === "working";
  const activity = connected
    ? levels.output > AUDIO_ACTIVITY_THRESHOLD
      ? "assistant"
      : levels.input > AUDIO_ACTIVITY_THRESHOLD
        ? "user"
        : "idle"
    : "idle";
  const activityLevel = activity === "assistant" ? levels.output : levels.input;
  const toggleLabel = chatVisible ? copy.hideChat : copy.showChat;
  const ending = state === "ending";
  const errorDetailVisible = state === "error" && Boolean(errorMessage);
  const controlsVisible = controlsOpen || settingsOpen;
  const chatPanelTranslation = useChatPanelTranslation(chatVisible);

  const handleSelectOpenChange = useCallback((open: boolean) => {
    if (selectInteractionFrameRef.current !== null) {
      window.cancelAnimationFrame(selectInteractionFrameRef.current);
      selectInteractionFrameRef.current = null;
    }
    selectInteractionRef.current = true;
    if (!open) {
      // Radix closes the portalled Select before its focus/outside events have
      // fully settled. Keep the parent protected through the current frame.
      selectInteractionFrameRef.current = window.requestAnimationFrame(() => {
        selectInteractionRef.current = false;
        selectInteractionFrameRef.current = null;
      });
    }
  }, []);

  useEffect(
    () => () => {
      if (selectInteractionFrameRef.current !== null) {
        window.cancelAnimationFrame(selectInteractionFrameRef.current);
      }
    },
    [],
  );

  const closeControlsUnlessFocused = (event: MouseEvent<HTMLDivElement>) => {
    if (settingsOpen) return;
    if (!event.currentTarget.contains(document.activeElement)) {
      setControlsOpen(false);
    }
  };

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-4 end-4 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2 transition-transform duration-200 ease-[var(--ease-collapse)] motion-reduce:transition-none",
        className,
      )}
      style={{
        zIndex: 270,
        transform: `translateX(${chatPanelTranslation}px)`,
      }}
      data-realtime-voice-state={state}
      data-realtime-voice-activity={activity}
      data-realtime-voice-chat-offset={chatPanelTranslation}
    >
      {errorDetailVisible ? (
        <div
          role="alert"
          className="pointer-events-auto max-w-xs rounded-lg border border-destructive/30 bg-background px-3 py-2 text-sm text-destructive shadow-md"
        >
          {errorMessage}
        </div>
      ) : null}

      <div
        className="group pointer-events-auto flex items-center gap-2"
        onMouseEnter={() => setControlsOpen(true)}
        onMouseLeave={closeControlsUnlessFocused}
        onFocusCapture={() => setControlsOpen(true)}
        onBlurCapture={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setControlsOpen(false);
          }
        }}
      >
        <div
          id={controlsId}
          data-realtime-voice-controls={controlsVisible ? "open" : "closed"}
          className={cn(
            "flex items-center gap-1 rounded-full border border-border/70 bg-background/95 p-1 shadow-lg backdrop-blur-md transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none",
            controlsVisible
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "pointer-events-none opacity-0 ltr:translate-x-2 rtl:-translate-x-2 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-x-0 group-focus-within:opacity-100",
          )}
        >
          <span
            id={statusId}
            role={state === "error" && !errorDetailVisible ? "alert" : "status"}
            aria-live={
              state === "error" && !errorDetailVisible ? "assertive" : "polite"
            }
            className="sr-only"
          >
            {copy.status[state]}
          </span>

          {settings ? (
            <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverAnchor asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={ending}
                      onClick={() => setSettingsOpen((open) => !open)}
                      aria-label={copy.voiceSettings}
                      aria-expanded={settingsOpen}
                      className="size-8 rounded-full text-muted-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
                    >
                      <IconSettings />
                    </Button>
                  </PopoverAnchor>
                </TooltipTrigger>
                <TooltipContent>{copy.voiceSettings}</TooltipContent>
              </Tooltip>
              <PopoverContent
                side="top"
                align="end"
                sideOffset={10}
                className="w-[min(20rem,calc(100vw-2rem))] overflow-hidden p-0"
                onOpenAutoFocus={(event) => event.preventDefault()}
                onInteractOutside={(event) => {
                  const target = event.target;
                  if (
                    selectInteractionRef.current ||
                    (target instanceof Element &&
                      target.closest(
                        '[data-realtime-voice-setting-options="true"]',
                      ))
                  ) {
                    event.preventDefault();
                  }
                }}
              >
                <VoiceInlineSettings
                  settings={settings}
                  disabled={ending}
                  onSelectOpenChange={handleSelectOpenChange}
                />
              </PopoverContent>
            </Popover>
          ) : null}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={ending}
                onClick={onEndVoiceMode}
                aria-label={copy.endVoiceMode}
                className="size-8 rounded-full text-destructive transition-transform duration-150 ease-out hover:bg-destructive/10 hover:text-destructive active:scale-[0.97]"
              >
                <IconPhoneOff />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copy.endVoiceMode}</TooltipContent>
          </Tooltip>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              disabled={ending}
              onClick={() => {
                setControlsOpen(true);
                onToggleChat();
              }}
              aria-label={toggleLabel}
              aria-pressed={chatVisible}
              data-realtime-voice-chat-toggle="orb"
              aria-describedby={statusId}
              aria-controls={controlsId}
              aria-expanded={controlsVisible}
              className={cn(
                "relative isolate size-16 overflow-visible rounded-full ring-1 backdrop-blur-xl transition-transform duration-150 ease-out focus-visible:ring-offset-2 active:scale-[0.97] motion-reduce:transition-none",
                ORB_STATE_CLASSES[state],
              )}
            >
              <span className="relative z-10 flex items-center justify-center">
                {state === "connecting" ? (
                  <VoiceConnectingIndicator />
                ) : state !== "error" ? (
                  <VoiceWaveform
                    level={activityLevel}
                    reducedMotion={reducedMotion}
                    activity={activity}
                  />
                ) : (
                  <IconAlertTriangle />
                )}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{toggleLabel}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
