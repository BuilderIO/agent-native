export const REALTIME_VOICE_TURN_EVENT = "realtime_voice_turn";
export const REALTIME_VOICE_CORRECTION_WINDOW_MS = 10_000;

export interface RealtimeVoiceTurnMetricsContext {
  protocol: "live" | "realtime";
  intelligence: string;
  intelligenceSource: "user" | "default";
}

export interface RealtimeVoiceTurnMetrics {
  setContext: (context: RealtimeVoiceTurnMetricsContext) => void;
  userSpeechStarted: (at: number) => void;
  /** `timelineMs` is the provider's session clock, when the event has one. */
  userSpeechEnded: (at: number, timelineMs?: number) => void;
  assistantAudioStarted: (at: number, timelineMs?: number) => void;
  toolCallStarted: () => void;
  toolCallFinished: (
    at: number,
    result: { status: string; readOnly?: boolean },
  ) => void;
  /** Reports the open turn; nobody can speak again after the session ends. */
  sessionEnded: () => void;
}

interface Turn {
  speechEndedAt?: number | undefined;
  speechEndedTimelineMs?: number | undefined;
  firstAudioAt?: number | undefined;
  firstAudioTimelineMs?: number | undefined;
  responding: boolean;
  toolCalls: number;
  writeToolCalls: number;
  failedToolCalls: number;
  lastWriteCompletedAt?: number | undefined;
}

function emptyTurn(): Turn {
  return {
    responding: false,
    toolCalls: 0,
    writeToolCalls: 0,
    failedToolCalls: 0,
  };
}

/**
 * One event per voice turn: from the end of the user's speech to the next time
 * they speak. It carries timings and counts only, never transcript text or
 * tool arguments.
 */
export function createRealtimeVoiceTurnMetrics(
  emit: (name: string, properties: Record<string, unknown>) => void,
  correctionWindowMs = REALTIME_VOICE_CORRECTION_WINDOW_MS,
): RealtimeVoiceTurnMetrics {
  let context: RealtimeVoiceTurnMetricsContext | undefined;
  let turn = emptyTurn();
  let turnIndex = 0;

  const report = (nextSpeechAt?: number) => {
    const current = turn;
    turn = emptyTurn();
    if (current.speechEndedAt === undefined && current.toolCalls === 0) return;
    const { speechEndedTimelineMs, firstAudioTimelineMs } = current;
    const sessionClock =
      speechEndedTimelineMs !== undefined && firstAudioTimelineMs !== undefined;
    const speechToAudioMs = sessionClock
      ? firstAudioTimelineMs - speechEndedTimelineMs
      : current.speechEndedAt !== undefined &&
          current.firstAudioAt !== undefined
        ? current.firstAudioAt - current.speechEndedAt
        : null;
    const msAfterEdit =
      current.lastWriteCompletedAt !== undefined && nextSpeechAt !== undefined
        ? Math.max(0, Math.round(nextSpeechAt - current.lastWriteCompletedAt))
        : null;
    emit(REALTIME_VOICE_TURN_EVENT, {
      protocol: context?.protocol ?? null,
      intelligence: context?.intelligence ?? null,
      intelligence_source: context?.intelligenceSource ?? null,
      turn_index: turnIndex++,
      speech_to_audio_ms:
        speechToAudioMs === null
          ? null
          : Math.max(0, Math.round(speechToAudioMs)),
      latency_clock:
        speechToAudioMs === null ? null : sessionClock ? "session" : "browser",
      tool_calls: current.toolCalls,
      write_tool_calls: current.writeToolCalls,
      failed_tool_calls: current.failedToolCalls,
      spoke_again_after_edit:
        current.lastWriteCompletedAt === undefined
          ? null
          : msAfterEdit !== null && msAfterEdit <= correctionWindowMs,
      ms_after_edit: msAfterEdit,
    });
  };

  return {
    setContext(next) {
      context = next;
    },
    userSpeechStarted(at) {
      if (turn.responding) report(at);
    },
    userSpeechEnded(at, timelineMs) {
      if (turn.responding) report(at);
      turn.speechEndedAt = at;
      turn.speechEndedTimelineMs = timelineMs;
      turn.firstAudioAt = undefined;
      turn.firstAudioTimelineMs = undefined;
    },
    assistantAudioStarted(at, timelineMs) {
      turn.responding = true;
      if (turn.firstAudioAt !== undefined) return;
      turn.firstAudioAt = at;
      turn.firstAudioTimelineMs = timelineMs;
    },
    toolCallStarted() {
      turn.responding = true;
      turn.toolCalls += 1;
    },
    toolCallFinished(at, result) {
      if (result.status === "failed") {
        turn.failedToolCalls += 1;
      } else if (result.status === "completed" && result.readOnly !== true) {
        turn.writeToolCalls += 1;
        turn.lastWriteCompletedAt = at;
      }
    },
    sessionEnded() {
      report();
      turnIndex = 0;
    },
  };
}
