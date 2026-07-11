import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconAlertTriangle,
  IconLoader2,
  IconMicrophone,
  IconPhoneOff,
  IconSettings,
  IconVolume,
} from "@tabler/icons-react";
import {
  type MouseEvent,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from "react";

import {
  Popover,
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
  microphoneSettings: string;
  status: Record<RealtimeVoiceModeState, string>;
  errors: {
    unsupported: string;
    responseFailed: string;
    sessionFailed: string;
    channelDisconnected: string;
    connectionFailed: string;
    offerFailed: string;
  };
}

export interface RealtimeVoiceModeEntryProps {
  copy: RealtimeVoiceModeCopy;
  disabled?: boolean;
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
        className={cn(
          "p-4",
          setupRequired
            ? "w-[min(30rem,calc(100vw-2rem))]"
            : "w-[min(22rem,calc(100vw-2rem))]",
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

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-nowrap sm:justify-end">
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
                onClick={() => choose(onStartVoiceMode)}
              >
                <IconMicrophone />
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
  onOpenMicrophoneSettings?: () => void;
  errorMessage?: string | null;
  className?: string;
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
  activity: "user" | "assistant";
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
          style={{ transform: `scaleY(${0.2 + visibleLevel * 0.8 * weight})` }}
        />
      ))}
    </span>
  );
}

const ORB_STATE_CLASSES: Record<RealtimeVoiceModeState, string> = {
  connecting:
    "bg-secondary text-secondary-foreground ring-secondary/40 hover:bg-secondary/80",
  listening:
    "bg-primary text-primary-foreground ring-primary/20 hover:bg-primary/90",
  speaking:
    "bg-foreground text-background ring-foreground/20 hover:bg-foreground/90",
  working:
    "bg-secondary text-secondary-foreground ring-secondary/40 hover:bg-secondary/80",
  error:
    "bg-destructive text-destructive-foreground ring-destructive/20 hover:bg-destructive/90",
  ending: "cursor-wait bg-muted text-muted-foreground ring-muted/40",
};

function VoiceStateIcon({ state }: { state: RealtimeVoiceModeState }) {
  switch (state) {
    case "connecting":
      return (
        <IconLoader2 className="animate-spin motion-reduce:animate-none" />
      );
    case "listening":
      return <IconMicrophone />;
    case "speaking":
      return <IconVolume />;
    case "working":
    case "ending":
      return (
        <IconLoader2 className="animate-spin motion-reduce:animate-none" />
      );
    case "error":
      return <IconAlertTriangle />;
  }
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
  onOpenMicrophoneSettings,
  errorMessage,
  className,
}: RealtimeVoiceModeDockProps) {
  const statusId = useId();
  const controlsId = useId();
  const [controlsOpen, setControlsOpen] = useState(false);
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
  const orbScale = reducedMotion ? 1 : 1 + Math.min(activityLevel, 1) * 0.07;

  const closeControlsUnlessFocused = (event: MouseEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(document.activeElement)) {
      setControlsOpen(false);
    }
  };

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-4 end-4 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2",
        className,
      )}
      style={{ zIndex: 270 }}
      data-realtime-voice-state={state}
      data-realtime-voice-activity={activity}
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
          data-realtime-voice-controls={controlsOpen ? "open" : "closed"}
          className={cn(
            "flex items-center gap-1 rounded-full border border-border/70 bg-background/95 p-1 ps-3 shadow-lg backdrop-blur-md transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none",
            controlsOpen
              ? "pointer-events-auto translate-x-0 opacity-100"
              : "pointer-events-none opacity-0 ltr:translate-x-2 rtl:-translate-x-2 group-hover:pointer-events-auto group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-x-0 group-focus-within:opacity-100",
          )}
        >
          <div
            id={statusId}
            role={state === "error" && !errorDetailVisible ? "alert" : "status"}
            aria-live={
              state === "error" && !errorDetailVisible ? "assertive" : "polite"
            }
            className="me-1 whitespace-nowrap text-xs font-medium text-foreground"
          >
            {copy.status[state]}
          </div>

          {onOpenMicrophoneSettings ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={ending}
                  onClick={onOpenMicrophoneSettings}
                  aria-label={copy.microphoneSettings}
                  className="size-8 rounded-full text-muted-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
                >
                  <IconSettings />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copy.microphoneSettings}</TooltipContent>
            </Tooltip>
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
              aria-describedby={statusId}
              aria-controls={controlsId}
              aria-expanded={controlsOpen}
              className={cn(
                "relative isolate size-16 overflow-visible rounded-full ring-4 shadow-xl transition-transform duration-150 ease-out focus-visible:ring-offset-2 active:scale-[0.97] motion-reduce:transition-none",
                ORB_STATE_CLASSES[state],
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute -inset-2 -z-10 rounded-full bg-current opacity-0 blur-md transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none",
                  activity !== "idle" && "opacity-20",
                )}
                style={{ transform: `scale(${orbScale})` }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-1 overflow-hidden rounded-full bg-gradient-to-br from-background/70 via-background/15 to-transparent opacity-70"
              >
                <span className="absolute start-2.5 top-2 size-3 rounded-full bg-background/70 blur-[1px]" />
                <span
                  className="absolute -bottom-2 -end-1 h-8 w-10 rounded-full bg-background/25 blur-md transition-transform duration-150 ease-out motion-reduce:transition-none"
                  style={{
                    transform: `scale(${reducedMotion ? 1 : 1 + activityLevel * 0.25})`,
                  }}
                />
              </span>
              <span className="relative z-10 flex items-center justify-center">
                {activity === "idle" ? (
                  <VoiceStateIcon state={state} />
                ) : (
                  <VoiceWaveform
                    level={activityLevel}
                    reducedMotion={reducedMotion}
                    activity={activity}
                  />
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
