import {
  IconLoader2,
  IconMicrophone,
  IconMicrophoneOff,
  IconVolume,
  IconVolumeOff,
  IconX,
} from "@tabler/icons-react";

import { Button } from "../ui/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import { realtimeVoiceToolLabel } from "./realtime-voice-transcript.js";
import type { RealtimeVoiceModeApi } from "./useRealtimeVoiceMode.js";
import { VoiceLevelWaveform } from "./voice-waveform.js";

export type RealtimeVoiceModeState =
  | "connecting"
  | "listening"
  | "speaking"
  | "working"
  | "error"
  | "ending";

export interface RealtimeVoiceModeCopy {
  startVoiceMode: string;
  endVoiceMode: string;
  voiceSettings: string;
  /** Composer placeholder while voice chat owns the conversation. */
  placeholder: string;
  muteMicrophone: string;
  unmuteMicrophone: string;
  muteSpeaker: string;
  unmuteSpeaker: string;
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
  /** Shown while working with no tool running: the model is deciding. */
  thinking: string;
  approval: {
    question: (toolLabel: string) => string;
    approve: string;
    deny: string;
  };
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

const TOOLBAR_CONTROL_CLASS =
  "flex size-[var(--agentkit-composer-toolbar-control-size,1.5rem)] shrink-0 items-center justify-center rounded-[var(--agentkit-composer-control-radius,var(--radius-md))] text-muted-foreground transition-colors duration-150 hover:bg-accent/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 aria-pressed:bg-accent aria-pressed:text-foreground";

/**
 * The composer's voice chat controls, in the mic's toolbar slot: who is
 * speaking, and speaker and microphone mute toggles. Voice device, language
 * and voice style live in Settings.
 */
export function RealtimeVoiceComposerControls({
  voice,
  copy,
}: {
  voice: RealtimeVoiceModeApi;
  copy: RealtimeVoiceModeCopy;
}) {
  const state = voice.state === "idle" ? "ending" : voice.state;
  const ending = state === "ending";
  const assistantSpeaking = state === "speaking";
  const speakerLabel = voice.outputMuted
    ? copy.unmuteSpeaker
    : copy.muteSpeaker;
  const microphoneLabel = voice.inputMuted
    ? copy.unmuteMicrophone
    : copy.muteMicrophone;

  const approval = state === "ending" ? undefined : voice.approvals[0];

  return (
    <>
      {approval ? (
        <div
          data-agent-composer-slot="voice-chat-approval"
          className="flex min-w-0 shrink items-center gap-1"
        >
          <span
            role="status"
            aria-live="polite"
            className="min-w-0 truncate ps-1 agent-kit-caption-copy text-foreground"
          >
            {copy.approval.question(realtimeVoiceToolLabel(approval.toolName))}
          </span>
          <Button
            type="button"
            size="xs"
            onClick={() => void voice.resolveApproval(approval.callId, true)}
          >
            {copy.approval.approve}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => void voice.resolveApproval(approval.callId, false)}
          >
            {copy.approval.deny}
          </Button>
        </div>
      ) : state !== "error" ? (
        <div
          data-agent-composer-slot="voice-chat-status"
          data-voice-speaker={
            assistantSpeaking
              ? "assistant"
              : state === "listening"
                ? "user"
                : "idle"
          }
          className="flex h-[var(--agentkit-composer-toolbar-control-size,1.5rem)] min-w-0 shrink items-center gap-1.5 overflow-hidden rounded-full bg-muted ps-2 pe-2.5 transition-[width,background-color] duration-150 ease-out starting:bg-transparent motion-reduce:transition-none"
        >
          {state === "connecting" ? (
            <IconLoader2
              aria-hidden="true"
              className="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
            />
          ) : (
            <VoiceLevelWaveform
              // The assistant's reply shows in muted bars so the two voices
              // read apart at a glance.
              className={
                assistantSpeaking ? "text-muted-foreground" : "text-foreground"
              }
              read={() => {
                const levels = voice.audioLevels.getSnapshot();
                return assistantSpeaking ? levels.output : levels.input;
              }}
              live={
                state === "listening" ||
                state === "speaking" ||
                state === "working"
              }
            />
          )}
          <span
            role="status"
            aria-live="polite"
            className="min-w-0 truncate agent-kit-caption-copy text-muted-foreground"
          >
            {state === "working"
              ? voice.currentToolName
                ? realtimeVoiceToolLabel(voice.currentToolName)
                : copy.thinking
              : copy.status[state]}
          </span>
        </div>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-agent-composer-slot="voice-chat-speaker"
            aria-label={copy.muteSpeaker}
            aria-pressed={voice.outputMuted}
            disabled={ending}
            onClick={() => voice.setOutputMuted(!voice.outputMuted)}
            className={TOOLBAR_CONTROL_CLASS}
          >
            {voice.outputMuted ? (
              <IconVolumeOff aria-hidden="true" className="size-4" />
            ) : (
              <IconVolume aria-hidden="true" className="size-4" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>{speakerLabel}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-agent-composer-slot="voice-chat-microphone"
            aria-label={copy.muteMicrophone}
            aria-pressed={voice.inputMuted}
            disabled={ending}
            onClick={() => voice.setInputMuted(!voice.inputMuted)}
            className={TOOLBAR_CONTROL_CLASS}
          >
            {voice.inputMuted ? (
              <IconMicrophoneOff aria-hidden="true" className="size-4" />
            ) : (
              <IconMicrophone aria-hidden="true" className="size-4" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>{microphoneLabel}</TooltipContent>
      </Tooltip>
    </>
  );
}

/** Ends voice chat from the composer's primary slot; ending is not destructive. */
export function RealtimeVoiceEndButton({
  voice,
  copy,
}: {
  voice: RealtimeVoiceModeApi;
  copy: RealtimeVoiceModeCopy;
}) {
  const settling = voice.state === "connecting" || voice.state === "ending";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-agent-composer-slot="send-button"
          data-composer-primary="end-voice-chat"
          aria-label={copy.endVoiceMode}
          aria-busy={settling || undefined}
          disabled={voice.state === "ending"}
          onClick={() =>
            voice.state === "error" ? voice.dismissError() : voice.end()
          }
          className="agent-composer-send-button shrink-0 flex size-[var(--agentkit-composer-primary-control-size,1.75rem)] items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 transition-[opacity,transform] duration-150 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <span
            key={settling ? "settling" : "end"}
            className="flex items-center justify-center transition-[opacity,scale] duration-150 ease-out starting:scale-75 starting:opacity-0 motion-reduce:transition-none"
          >
            {settling ? (
              <IconLoader2 className="size-[var(--agentkit-composer-primary-icon-size,0.875rem)] animate-spin motion-reduce:animate-none" />
            ) : (
              <IconX className="size-[var(--agentkit-composer-primary-icon-size,0.875rem)]" />
            )}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{copy.endVoiceMode}</TooltipContent>
    </Tooltip>
  );
}
