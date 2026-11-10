export const REALTIME_VOICE_TURN_EVENT = "realtime_voice_turn";
export const REALTIME_VOICE_CORRECTION_WINDOW_MS = 10_000;

export interface RealtimeVoiceTurnMetricsContext {
  protocol: "live" | "realtime";
  intelligence: string;
  intelligenceSource: "user" | "default";
}

/**
 * Records how a tool call that started in a turn ended. Only a call classified
 * `readOnly: false` counts as an edit; an unclassified call is neither.
 */
export type RealtimeVoiceTurnToolCallFinish = (
  at: number,
  result: { status: string; readOnly?: boolean | undefined },
) => void;

export interface RealtimeVoiceTurnMetrics {
  setContext: (context: RealtimeVoiceTurnMetricsContext) => void;
  /** Realtime: the provider heard the user start speaking. */
  userSpeechStarted: (at: number) => void;
  /** Realtime: the provider heard the user stop speaking. */
  userSpeechEnded: (at: number) => void;
  /**
   * GPT-Live: a user turn's transcript grew. `turnId` names the transcript
   * turn and `endMs` is its end on the session clock, so late text from a turn
   * already answered never starts another.
   */
  userTurnUpdated: (at: number, turnId: string, endMs: number) => void;
  /** The assistant replied in text, which carries no audio timing. */
  assistantResponded: () => void;
  /** `timelineMs` is the provider's session clock, when the event has one. */
  assistantAudioStarted: (at: number, timelineMs?: number) => void;
  /** The returned function records the call's outcome against this turn. */
  toolCallStarted: () => RealtimeVoiceTurnToolCallFinish;
  /** Reports the open turn; nobody can speak again after the session ends. */
  sessionEnded: () => void;
}

interface Turn {
  userTurnId?: string | undefined;
  speechEndedAt?: number | undefined;
  speechEndedTimelineMs?: number | undefined;
  firstAudioAt?: number | undefined;
  firstAudioTimelineMs?: number | undefined;
  responding: boolean;
  toolCalls: number;
  pendingToolCalls: number;
  writeToolCalls: number;
  failedToolCalls: number;
  lastWriteCompletedAt?: number | undefined;
  /** Reported while a call still ran; it is sent once the last call ends. */
  heldReport?: { index: number; nextSpeechAt: number | undefined } | undefined;
}

function emptyTurn(): Turn {
  return {
    responding: false,
    toolCalls: 0,
    pendingToolCalls: 0,
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

  const send = (
    current: Turn,
    index: number,
    nextSpeechAt: number | undefined,
  ) => {
    const { speechEndedTimelineMs, firstAudioTimelineMs } = current;
    const sessionClock =
      speechEndedTimelineMs !== undefined && firstAudioTimelineMs !== undefined;
    const speechToAudioMs = sessionClock
      ? firstAudioTimelineMs - speechEndedTimelineMs
      : current.speechEndedAt !== undefined &&
          current.firstAudioAt !== undefined
        ? current.firstAudioAt - current.speechEndedAt
        : null;
    // Speech that began while the edit still ran did not answer the edit.
    const msAfterEdit =
      current.lastWriteCompletedAt !== undefined &&
      nextSpeechAt !== undefined &&
      nextSpeechAt >= current.lastWriteCompletedAt
        ? Math.round(nextSpeechAt - current.lastWriteCompletedAt)
        : null;
    emit(REALTIME_VOICE_TURN_EVENT, {
      protocol: context?.protocol ?? null,
      intelligence: context?.intelligence ?? null,
      intelligence_source: context?.intelligenceSource ?? null,
      turn_index: index,
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

  const report = (nextSpeechAt?: number) => {
    const current = turn;
    turn = emptyTurn();
    if (current.speechEndedAt === undefined && current.toolCalls === 0) return;
    const index = turnIndex++;
    if (current.pendingToolCalls > 0) {
      current.heldReport = { index, nextSpeechAt };
      return;
    }
    send(current, index, nextSpeechAt);
  };

  return {
    setContext(next) {
      context = next;
    },
    userSpeechStarted(at) {
      if (turn.responding) report(at);
    },
    userSpeechEnded(at) {
      if (turn.responding) report(at);
      turn.speechEndedAt = at;
    },
    userTurnUpdated(at, turnId, endMs) {
      if (turn.userTurnId === turnId) {
        if (turn.responding) return;
      } else if (turn.responding) {
        report(at);
      }
      turn.userTurnId = turnId;
      turn.speechEndedAt = at;
      turn.speechEndedTimelineMs = endMs;
    },
    assistantResponded() {
      turn.responding = true;
    },
    assistantAudioStarted(at, timelineMs) {
      turn.responding = true;
      if (turn.firstAudioAt !== undefined) return;
      turn.firstAudioAt = at;
      turn.firstAudioTimelineMs = timelineMs;
    },
    toolCallStarted() {
      const owner = turn;
      owner.responding = true;
      owner.toolCalls += 1;
      owner.pendingToolCalls += 1;
      let finished = false;
      return (at, result) => {
        if (finished) return;
        finished = true;
        owner.pendingToolCalls -= 1;
        if (result.status === "failed") {
          owner.failedToolCalls += 1;
        } else if (result.status === "completed" && result.readOnly === false) {
          owner.writeToolCalls += 1;
          owner.lastWriteCompletedAt = at;
        }
        const held = owner.heldReport;
        if (owner.pendingToolCalls > 0 || !held) return;
        owner.heldReport = undefined;
        send(owner, held.index, held.nextSpeechAt);
      };
    },
    sessionEnded() {
      report();
      turnIndex = 0;
    },
  };
}
