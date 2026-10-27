import {
  IconAlertTriangle,
  IconArrowUp,
  IconLoader2,
  IconMicrophone,
  IconPlayerStopFilled,
  IconX,
} from "@tabler/icons-react";
import type { MouseEvent } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import { cn } from "../utils.js";
import {
  RealtimeVoiceComposerControls,
  RealtimeVoiceEndButton,
} from "./RealtimeVoiceMode.js";
import { useComposerRuntimeAdapters } from "./runtime-adapters.js";
import {
  type RealtimeVoiceModeApi,
  useRealtimeVoiceModeCopy,
  useRealtimeVoiceModeOptional,
} from "./useRealtimeVoiceMode.js";
import type { VoiceDictationApi } from "./useVoiceDictation.js";
import { IconVoiceChat } from "./voice-chat-icon.js";
import { VoiceLevelWaveform } from "./voice-waveform.js";

export interface VoiceButtonProps {
  voice: VoiceDictationApi;
  isMac: boolean;
  disabled?: boolean;
  /** Overrides for the trigger, such as the larger primary-slot size. */
  className?: string;
  /** Show a live voice-chat session's controls in this slot (default: true). */
  voiceChat?: boolean;
}

/**
 * The composer's dictation control. Idle it is the mic; once dictation starts
 * it becomes the recording pill in the same toolbar slot. During voice chat
 * the slot holds the session's status and mute controls instead.
 */
export function VoiceButton({
  voice,
  isMac,
  disabled,
  className,
  voiceChat = true,
}: VoiceButtonProps) {
  const t = useComposerRuntimeAdapters().translate;
  const realtimeVoice = useRealtimeVoiceModeOptional();

  if (voiceChat && realtimeVoice?.active) {
    return <ActiveVoiceChatControls voice={realtimeVoice} />;
  }
  if (!voice.supported) return null;
  if (isVoiceRecordingActive(voice.state)) {
    return <VoiceDictationPill voice={voice} />;
  }

  const shortcut = isMac ? "⌘⇧M" : "Ctrl+Shift+M";
  const label = t("agentChat.voice.dictation.start", {
    shortcut,
    defaultValue: `Dictate (${shortcut})`,
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-agent-composer-slot="voice-button"
          onClick={() => void voice.start()}
          disabled={disabled}
          aria-label={label}
          className={cn(
            "shrink-0 flex size-[var(--agentkit-composer-toolbar-control-size,1.5rem)] items-center justify-center rounded-[var(--agentkit-composer-control-radius,var(--radius-md))] text-muted-foreground transition-colors duration-150 hover:bg-accent/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30",
            className,
          )}
        >
          <IconMicrophone className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export interface VoiceRecordingOverlayProps {
  voice: VoiceDictationApi;
}

/** The dictation failure row. Recording itself renders in the toolbar. */
export function VoiceRecordingOverlay({ voice }: VoiceRecordingOverlayProps) {
  const { state, errorMessage, dismissError, start } = voice;
  const t = useComposerRuntimeAdapters().translate!;

  if (state === "error" && errorMessage) {
    return (
      <div
        role="alert"
        className="mx-2 mt-1 flex items-start gap-2 rounded-md border border-[hsl(var(--agent-kit-warning)/0.4)] bg-[hsl(var(--agent-kit-warning)/0.1)] px-2 py-1.5 agent-kit-caption-copy text-foreground"
      >
        <IconAlertTriangle
          aria-hidden="true"
          className="mt-0.5 h-3 w-3 shrink-0 text-[hsl(var(--agent-kit-warning))]"
        />
        <span className="flex-1 min-w-0">{errorMessage}</span>
        <button
          type="button"
          onClick={() => {
            dismissError();
            void start();
          }}
          className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 agent-kit-caption-copy font-medium text-foreground hover:bg-[hsl(var(--agent-kit-warning)/0.15)]"
        >
          {t("agentChat.common.retry", { defaultValue: "Try again" })}
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={dismissError}
              className="-my-1 -me-1 shrink-0 flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-[hsl(var(--agent-kit-warning)/0.15)] hover:text-foreground"
              aria-label={t("agentChat.common.dismiss", {
                defaultValue: "Dismiss",
              })}
            >
              <IconX aria-hidden="true" className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {t("agentChat.common.dismiss", { defaultValue: "Dismiss" })}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return null;
}

function ActiveVoiceChatControls({ voice }: { voice: RealtimeVoiceModeApi }) {
  const copy = useRealtimeVoiceModeCopy();
  return <RealtimeVoiceComposerControls voice={voice} copy={copy} />;
}

export function isVoiceRecordingActive(state: VoiceDictationApi["state"]) {
  return (
    state === "recording" || state === "starting" || state === "transcribing"
  );
}

/**
 * The mic's recording state: a live waveform and a stop control in a pill that
 * grows out of the mic's slot. Stop inserts the transcript; Escape, or the
 * control while the recording transcribes, cancels it.
 */
export function VoiceDictationPill({ voice }: VoiceRecordingOverlayProps) {
  const { state, levels, stop, cancel } = voice;
  const t = useComposerRuntimeAdapters().translate;
  const transcribing = state === "transcribing";
  const controlLabel = transcribing
    ? t("agentChat.voice.dictation.cancelTranscription", {
        defaultValue: "Cancel transcription",
      })
    : t("agentChat.voice.dictation.stopRecording", {
        defaultValue: "Stop recording",
      });

  return (
    <div
      data-agent-composer-slot="voice-recording"
      data-voice-state={state}
      role="group"
      aria-label={t("agentChat.voice.dictation.recording", {
        defaultValue: "Dictating",
      })}
      className="flex h-[var(--agentkit-composer-toolbar-control-size,1.5rem)] w-[4.5rem] shrink-0 items-center justify-between gap-1.5 overflow-hidden rounded-full bg-muted ps-2.5 pe-0.5 text-foreground transition-[width,background-color] duration-150 ease-out starting:w-[var(--agentkit-composer-toolbar-control-size,1.5rem)] starting:bg-transparent motion-reduce:transition-none"
    >
      {transcribing ? (
        <span
          role="status"
          aria-label={t("agentChat.voice.dictation.transcribing", {
            defaultValue: "Transcribing…",
          })}
          className="flex flex-1 items-center justify-center text-muted-foreground"
        >
          <IconLoader2
            aria-hidden="true"
            className="size-4 animate-spin motion-reduce:animate-none"
          />
        </span>
      ) : (
        <VoiceLevelWaveform
          read={() => levels.getSnapshot().input}
          live={state === "recording"}
        />
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-agent-composer-slot="voice-stop"
            onClick={state === "recording" ? stop : cancel}
            aria-label={controlLabel}
            className="flex size-[calc(var(--agentkit-composer-toolbar-control-size,1.5rem)-0.25rem)] shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-colors duration-150 hover:bg-foreground/80"
          >
            {transcribing ? (
              <IconX aria-hidden="true" className="size-3" />
            ) : (
              <IconPlayerStopFilled aria-hidden="true" className="size-2.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>{controlLabel}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export interface ComposerSendButtonProps {
  onSend: (event: MouseEvent<HTMLButtonElement>) => void;
  sendDisabled: boolean;
  sendLabel: string;
  busy?: boolean;
  /** Mounts the voice-chat variant; keep it stable for the composer's lifetime. */
  voiceEnabled?: boolean;
  /** Nothing to send and no run active, so the slot may offer voice chat. */
  voiceChatEligible?: boolean;
  /** Starts voice chat in place of the provider's default start. */
  onVoiceChatStart?: () => void;
  disabled?: boolean;
}

/**
 * The composer's primary slot. With an empty draft it starts realtime voice
 * chat when a voice provider is ready; any draft turns it back into Send.
 */
export function ComposerSendButton({
  voiceEnabled = false,
  ...props
}: ComposerSendButtonProps) {
  return voiceEnabled ? (
    <VoiceChatSendButton {...props} />
  ) : (
    <ComposerPrimaryButton
      mode="send"
      onClick={props.onSend}
      disabled={props.sendDisabled}
      label={props.sendLabel}
      busy={props.busy}
    />
  );
}

function VoiceChatSendButton({
  onSend,
  sendDisabled,
  sendLabel,
  busy,
  voiceChatEligible = false,
  onVoiceChatStart,
  disabled,
}: Omit<ComposerSendButtonProps, "voiceEnabled">) {
  const adapters = useComposerRuntimeAdapters();
  const realtimeVoice = useRealtimeVoiceModeOptional();
  const copy = useRealtimeVoiceModeCopy();
  const { status } = adapters.voice.useProviderStatus();
  if (realtimeVoice?.active) {
    return <RealtimeVoiceEndButton voice={realtimeVoice} copy={copy} />;
  }
  const offerVoiceChat =
    voiceChatEligible &&
    !busy &&
    realtimeVoice !== null &&
    !realtimeVoice.active &&
    isRealtimeVoiceChatAvailable(status);

  return offerVoiceChat ? (
    <ComposerPrimaryButton
      mode="voice-chat"
      onClick={() =>
        onVoiceChatStart ? onVoiceChatStart() : void realtimeVoice.start()
      }
      disabled={Boolean(disabled)}
      label={copy.startVoiceMode}
    />
  ) : (
    <ComposerPrimaryButton
      mode="send"
      onClick={onSend}
      disabled={sendDisabled}
      label={sendLabel}
      busy={busy}
    />
  );
}

/** Realtime voice needs managed Builder voice or an OpenAI key; unknown is unavailable. */
export function isRealtimeVoiceChatAvailable(
  status: { builder?: boolean; openai?: boolean } | null,
): boolean {
  return status?.builder === true || status?.openai === true;
}

function ComposerPrimaryButton({
  mode,
  onClick,
  disabled,
  label,
  busy,
}: {
  mode: "send" | "voice-chat";
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled: boolean;
  label: string;
  busy?: boolean | undefined;
}) {
  const iconClass =
    "size-[var(--agentkit-composer-primary-icon-size,0.875rem)]";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          aria-busy={busy || undefined}
          data-agent-composer-slot="send-button"
          data-composer-primary={mode}
          className="agent-composer-send-button shrink-0 flex size-[var(--agentkit-composer-primary-control-size,1.75rem)] items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 transition-[opacity,transform] duration-150 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {/* Keyed so the glyph swap replays the entry transition in place. */}
          <span
            key={mode}
            className="flex items-center justify-center transition-[opacity,scale] duration-150 ease-out starting:scale-75 starting:opacity-0 motion-reduce:transition-none"
          >
            {busy ? (
              <IconLoader2
                className={cn(
                  iconClass,
                  "animate-spin motion-reduce:animate-none",
                )}
              />
            ) : mode === "voice-chat" ? (
              <IconVoiceChat className={iconClass} />
            ) : (
              <IconArrowUp className={iconClass} />
            )}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
