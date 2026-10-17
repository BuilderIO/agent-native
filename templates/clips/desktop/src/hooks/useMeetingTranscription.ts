import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useMemo, useRef } from "react";

import type { ClipsActionError } from "../lib/clips-action";
import { withMeetingActionTimeout } from "../lib/meeting-action-timeout";
import { callAppBundleIdsForJoinUrl } from "../lib/meeting-call-app";
import {
  canDiscardTerminalTranscriptForReplacement,
  isTerminalMeetingStopError,
  isTerminalTranscriptSaveResult,
  shouldHoldQuitForTranscriptRecovery,
  stopMeetingBeforeTranscriptFlush,
} from "../lib/meeting-stop";
import { writeClipboardText } from "../lib/recording-link";
import { subscribeAutoStop } from "../lib/silence-events";
import {
  appendFinalTranscript,
  onFinalTranscript,
  restartTranscriptionEngine,
  startTranscriptionEngine,
  stopTranscriptionEngine,
  transcriptFullText,
  transcriptLineFromSegment,
  transcriptSegments,
  type SourcedTranscriptSegment,
  type TranscriptionEngine,
  type TranscriptLine,
} from "../lib/transcription-engine";
import { normalizeServerUrl } from "../lib/url";

export interface MeetingTranscriptionPayload {
  meetingId: string;
  joinUrl?: string | null;
  platform?: string | null;
  browserBundleId?: string | null;
  reason?: "user" | "calendar-auto" | (string & {});
  scheduledStart?: string | null;
  includeFromMeetingStart?: boolean;
}

interface MeetingTranscriptionSession {
  meetingId: string;
  recordingId: string | null;
  lines: TranscriptLine[];
  unlisten: Array<() => void>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  stopping: boolean;
  stopPending: boolean;
  pendingStopReason: string | null;
  stopRecovery:
    | {
        status: "terminal";
        source: "stop";
        error: ClipsActionError;
        transcriptError?: unknown;
      }
    | { status: "terminal"; source: "transcript"; error: unknown }
    | null;
  paused: boolean;
  engine: TranscriptionEngine;
  audioTransitionInFlight: Promise<void> | null;
  liveTimelineOffsetMs: number;
  historyInFlight: Promise<void> | null;
  flushInFlight: Promise<void> | null;
  flushSeq: number;
  dirtySeq: number;
}

interface PillTranscriptLine {
  text: string;
  source: "mic" | "system";
  startMs?: number;
}

function pillTranscriptLines(lines: TranscriptLine[]): PillTranscriptLine[] {
  return lines.map((line) => ({
    text: line.text,
    source: line.source,
    startMs: line.startMs ?? undefined,
  }));
}

type CallClipsAction = <T>(
  name: string,
  body: Record<string, unknown>,
  opts?: { method?: "GET" | "POST"; signal?: AbortSignal },
) => Promise<T>;

interface Props {
  callClipsAction: CallClipsAction;
  serverUrl: string;
  selectedMicId: string | null;
  selectedMicLabel: string | null;
  enabled: boolean;
}

const MEETING_START_CANCELLED = Symbol("meeting-start-cancelled");
const MEETING_ENDED_POLL_MS = 30_000;
const MEETING_ACTION_TIMEOUT_MS = 10_000;
const RECOVERY_RETRY_INITIAL_MS = 3_000;
const RECOVERY_RETRY_MAX_MS = 30_000;

type StopTranscriptionResult =
  | { completed: true }
  | { completed: false; holdQuit: boolean; error: ClipsActionError };

function unlistenAll(unlisteners: Array<() => void>): void {
  for (const unlisten of unlisteners) {
    try {
      unlisten();
    } catch {
      continue;
    }
  }
}

export function useMeetingTranscription({
  callClipsAction,
  serverUrl,
  selectedMicId,
  selectedMicLabel,
  enabled,
}: Props): void {
  const sessionRef = useRef<MeetingTranscriptionSession | null>(null);
  const pendingStartRef = useRef<MeetingTranscriptionPayload | null>(null);
  const recoveryRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const recoveryRetryDelayRef = useRef(RECOVERY_RETRY_INITIAL_MS);
  const retryPendingWorkRef = useRef<(() => void) | null>(null);
  const quitTeardownPendingRef = useRef(false);
  const pendingPillInitRef = useRef<{
    meetingId: string;
    initialNotes: string;
    title?: string;
    preloadedLines?: PillTranscriptLine[];
    starting?: boolean;
  } | null>(null);

  const normalizedServerUrl = useMemo(
    () => normalizeServerUrl(serverUrl),
    [serverUrl],
  );

  const acknowledgeQuitTeardown = useCallback(async () => {
    if (!quitTeardownPendingRef.current) return;
    await invoke("quit_teardown_done");
    quitTeardownPendingRef.current = false;
  }, []);

  const scheduleRecoveryRetry = useCallback(() => {
    if (recoveryRetryTimerRef.current) return;
    const delay = recoveryRetryDelayRef.current;
    recoveryRetryDelayRef.current = Math.min(delay * 2, RECOVERY_RETRY_MAX_MS);
    recoveryRetryTimerRef.current = window.setTimeout(() => {
      recoveryRetryTimerRef.current = null;
      retryPendingWorkRef.current?.();
    }, delay);
  }, []);

  const flushTranscript = useCallback(async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    if (!session.recordingId) return;
    session.dirtySeq = session.flushSeq + 1;
    if (session.flushInFlight) {
      await session.flushInFlight;
      return;
    }
    if (!session.lines.length) return;

    const seq = session.dirtySeq;
    session.flushSeq = seq;
    const run = (async () => {
      await withMeetingActionTimeout(
        (signal) =>
          callClipsAction(
            "save-browser-transcript",
            {
              recordingId: session.recordingId,
              fullText: transcriptFullText(session.lines),
              segments: transcriptSegments(session.lines),
              source: session.engine,
              overwriteReady: true,
            },
            { signal },
          ),
        MEETING_ACTION_TIMEOUT_MS,
        "Saving the meeting transcript timed out.",
      );
      emit("clips:meeting-saved", {
        meetingId: session.meetingId,
        ts: Date.now(),
      }).catch(() => {});
      if (session.dirtySeq > seq) {
        session.flushInFlight = null;
        await flushTranscript();
      }
    })();
    session.flushInFlight = run;
    try {
      await run;
    } finally {
      if (session.flushInFlight === run) session.flushInFlight = null;
    }
  }, [callClipsAction]);

  const stopInFlightRef = useRef<Promise<StopTranscriptionResult> | null>(null);

  const stopTranscription = useCallback(
    async (reason: string = "manual") => {
      const session = sessionRef.current;
      if (!session) {
        await acknowledgeQuitTeardown();
        return;
      }
      if (session.stopping) {
        await stopInFlightRef.current;
        if (session.stopRecovery?.source === "transcript") return;
        await acknowledgeQuitTeardown();
        return;
      }
      const stopReason = session.stopPending
        ? (session.pendingStopReason ?? reason)
        : reason;
      session.stopping = true;
      const run = (async () => {
        if (session.flushTimer) {
          window.clearTimeout(session.flushTimer);
          session.flushTimer = null;
        }
        await session.audioTransitionInFlight?.catch(() => {});
        try {
          await stopTranscriptionEngine(session.engine);
        } catch (err) {
          console.warn("[clips-popover] meeting audio stop failed:", err);
        }
        unlistenAll(session.unlisten.splice(0));
        await invoke("silence_detector_stop").catch(() => {});
        let terminalStopError: ClipsActionError | undefined;
        try {
          let stopConfirmed = false;
          const result = await stopMeetingBeforeTranscriptFlush({
            stopRecording: async () => {
              const result = await withMeetingActionTimeout(
                (signal) =>
                  callClipsAction<{
                    actualEnd?: string | null;
                  }>(
                    "stop-meeting-recording",
                    {
                      meetingId: session.meetingId,
                      reason: stopReason,
                    },
                    { signal },
                  ),
                MEETING_ACTION_TIMEOUT_MS,
                "Stopping the meeting timed out.",
              );
              stopConfirmed = Boolean(result?.actualEnd);
            },
            isStopped: async () => stopConfirmed,
            waitForHistory: async () => {
              await session.historyInFlight?.catch(() => {});
            },
            flushTranscript: async () => {
              await flushTranscript();
            },
            terminalStopError:
              session.stopRecovery?.source === "stop"
                ? session.stopRecovery.error
                : undefined,
            onTerminalStopError: (error) => {
              session.stopRecovery = {
                status: "terminal",
                source: "stop",
                error,
              };
            },
          });
          if (
            result.status === "terminal" &&
            isTerminalTranscriptSaveResult(result)
          ) {
            session.stopRecovery = {
              status: "terminal",
              source: "transcript",
              error: result.error,
            };
            session.stopPending = true;
            session.pendingStopReason = stopReason;
            await invoke("set_recording_state", { active: false }).catch(
              () => {},
            );
            await emit("meetings:transcription-error", {
              meetingId: session.meetingId,
              error: result.error.message,
              terminal: true,
            }).catch(() => {});
            session.stopping = false;
            return {
              completed: false as const,
              holdQuit: shouldHoldQuitForTranscriptRecovery(
                quitTeardownPendingRef.current,
                result,
              ),
              error: result.error,
            };
          }
          if (result.status === "terminal") {
            terminalStopError = result.error;
          }
          session.stopRecovery = null;
        } catch (err) {
          if (sessionRef.current === session) {
            session.stopPending = true;
            session.pendingStopReason = stopReason;
            session.stopping = false;
            const terminalRecovery =
              session.stopRecovery ??
              (isTerminalMeetingStopError(err)
                ? {
                    status: "terminal" as const,
                    source: "transcript" as const,
                    error: err,
                  }
                : null);
            if (terminalRecovery) {
              session.stopRecovery = terminalRecovery;
              if (
                terminalRecovery.source === "stop" &&
                err !== terminalRecovery.error
              ) {
                terminalRecovery.transcriptError = err;
              }
              if (!isTerminalMeetingStopError(err)) {
                scheduleRecoveryRetry();
              } else if (recoveryRetryTimerRef.current) {
                window.clearTimeout(recoveryRetryTimerRef.current);
                recoveryRetryTimerRef.current = null;
              }
              const visibleError =
                terminalRecovery.source === "stop"
                  ? (terminalRecovery.transcriptError ?? terminalRecovery.error)
                  : terminalRecovery.error;
              emit("meetings:transcription-error", {
                meetingId: session.meetingId,
                error:
                  visibleError instanceof Error
                    ? visibleError.message
                    : undefined,
                terminal: true,
              }).catch(() => {});
            } else {
              scheduleRecoveryRetry();
            }
          }
          console.warn(
            "[clips-popover] meeting stop is incomplete; preserving session for retry:",
            err,
          );
          throw err;
        }
        // Keep completed notes in Clips instead of interrupting the user by
        // opening a browser tab. On a normal stop the pill stays up and
        // switches to its finished banner off `meetings:transcription-stopped`;
        // it hides itself once the user opens the meeting or dismisses it.
        // Guard the shared Rust-side state writes and sessionRef null-out by
        // identity. App quit and other callers can still race a stop against a
        // new start that slips in between awaits, and stale teardown must not
        // clobber the session that has since taken over.
        if (sessionRef.current === session) {
          session.stopPending = false;
          session.pendingStopReason = null;
          if (stopReason === "app-quit" || stopReason === "replaced") {
            await invoke("recording_pill_hide").catch(() => {});
          }
          await invoke("set_recording_state", { active: false }).catch(
            () => {},
          );
          await invoke("set_meeting_active", { active: false }).catch(() => {});
          sessionRef.current = null;
        }
        emit("meetings:transcription-stopped", {
          meetingId: session.meetingId,
          reason: stopReason,
        }).catch(() => {});
        if (terminalStopError) {
          emit("meetings:transcription-error", {
            meetingId: session.meetingId,
            error: terminalStopError.message,
            terminal: true,
          }).catch(() => {});
        }
        return { completed: true as const };
      })();
      stopInFlightRef.current = run;
      try {
        const completed = await run;
        if (!completed.completed) {
          if (completed.holdQuit) return;
          throw completed.error;
        }
        recoveryRetryDelayRef.current = RECOVERY_RETRY_INITIAL_MS;
        if (!pendingStartRef.current && recoveryRetryTimerRef.current) {
          window.clearTimeout(recoveryRetryTimerRef.current);
          recoveryRetryTimerRef.current = null;
        }
        await acknowledgeQuitTeardown();
      } finally {
        if (stopInFlightRef.current === run) stopInFlightRef.current = null;
      }
    },
    [
      acknowledgeQuitTeardown,
      callClipsAction,
      flushTranscript,
      normalizedServerUrl,
      scheduleRecoveryRetry,
    ],
  );

  useEffect(() => {
    if (enabled) return;
    pendingStartRef.current = null;
    stopTranscription("lab-disabled").catch(() => {});
  }, [enabled, stopTranscription]);

  const runStartTranscription = useCallback(
    async (payload: MeetingTranscriptionPayload) => {
      if (!enabled) return;
      const meetingId = payload.meetingId;
      if (!meetingId) return;

      const clearPendingStart = () => {
        if (pendingStartRef.current?.meetingId !== meetingId) return;
        pendingStartRef.current = null;
        recoveryRetryDelayRef.current = RECOVERY_RETRY_INITIAL_MS;
        if (recoveryRetryTimerRef.current) {
          window.clearTimeout(recoveryRetryTimerRef.current);
          recoveryRetryTimerRef.current = null;
        }
      };
      if (
        pendingStartRef.current &&
        pendingStartRef.current.meetingId !== meetingId
      ) {
        pendingStartRef.current = null;
        recoveryRetryDelayRef.current = RECOVERY_RETRY_INITIAL_MS;
        if (recoveryRetryTimerRef.current) {
          window.clearTimeout(recoveryRetryTimerRef.current);
          recoveryRetryTimerRef.current = null;
        }
      }
      if (quitTeardownPendingRef.current) return;

      const existing = sessionRef.current;
      if (existing) {
        if (
          !existing.stopping &&
          !existing.stopPending &&
          existing.meetingId === meetingId
        ) {
          clearPendingStart();
          await invoke("recording_pill_show", {
            meetingId: existing.meetingId,
            mode: "meeting",
          }).catch(() => {});
          emit("clips:pill-context", {
            meetingId: existing.meetingId,
            mode: "meeting",
          }).catch(() => {});
          emit("meetings:hide-notification", { meetingId }).catch(() => {});
          return;
        }
        try {
          await stopTranscription("replaced");
        } catch (error) {
          pendingStartRef.current = payload;
          const stoppedSession = sessionRef.current;
          if (stoppedSession?.stopRecovery?.source === "transcript") {
            emit("meetings:replacement-recovery-required", {
              meetingId,
              failedMeetingId: stoppedSession.meetingId,
            }).catch(() => {});
          } else {
            scheduleRecoveryRetry();
          }
          console.warn(
            "[clips-popover] replacement meeting queued until the previous recording is safely stopped:",
            error,
          );
          return;
        }
      }
      if (quitTeardownPendingRef.current) return;
      clearPendingStart();

      pendingPillInitRef.current = {
        meetingId,
        initialNotes: "",
        starting: true,
      };
      invoke("recording_pill_show", { meetingId, mode: "meeting" }).catch(
        () => {},
      );
      emit("clips:pill-context", {
        meetingId,
        mode: "meeting",
        starting: true,
      }).catch(() => {});
      emit("meetings:hide-notification", { meetingId }).catch(() => {});

      let engineStarting: Promise<TranscriptionEngine> | null = null;
      let liveEngine: TranscriptionEngine | null = null;
      let startedSession: MeetingTranscriptionSession | null = null;
      let historyPreparedRef: {
        current: {
          token: string;
          scheduledStart: string;
          capturedUntil: string;
        } | null;
      } = { current: null };
      let includeFromMeetingStart = payload.includeFromMeetingStart === true;
      try {
        if (
          !includeFromMeetingStart &&
          payload.reason === "user" &&
          payload.scheduledStart
        ) {
          try {
            const historyStatus = await invoke<{ available: boolean }>(
              "rewind_meeting_history_status",
              { scheduledStart: payload.scheduledStart },
            );
            includeFromMeetingStart = historyStatus.available === true;
          } catch (error) {
            console.warn(
              "[clips-popover] Rewind meeting history status unavailable:",
              error,
            );
          }
        }
        if (includeFromMeetingStart) {
          if (payload.reason !== "user" || !payload.scheduledStart) {
            throw new Error(
              "Include from meeting start is only available when you manually start a scheduled meeting.",
            );
          }
          historyPreparedRef.current = await invoke<{
            token: string;
            scheduledStart: string;
            capturedUntil: string;
          }>("rewind_meeting_history_prepare", {
            scheduledStart: payload.scheduledStart,
          });
        }

        const session: MeetingTranscriptionSession = {
          meetingId,
          recordingId: null,
          lines: [],
          unlisten: [],
          flushTimer: null,
          stopping: false,
          stopPending: false,
          pendingStopReason: null,
          stopRecovery: null,
          paused: false,
          engine: "whisper",
          audioTransitionInFlight: null,
          liveTimelineOffsetMs: 0,
          historyInFlight: null,
          flushInFlight: null,
          flushSeq: 0,
          dirtySeq: 0,
        };
        sessionRef.current = session;
        startedSession = session;
        const sessionIsActive = () =>
          sessionRef.current === session && !session.stopping;

        const scheduleFlush = () => {
          if (session.flushTimer) window.clearTimeout(session.flushTimer);
          session.flushTimer = window.setTimeout(() => {
            session.flushTimer = null;
            flushTranscript().catch((err) => {
              console.warn("[clips-popover] transcript flush failed:", err);
            });
          }, 1500);
        };

        const addUnlisten = (promise: Promise<() => void>) => {
          promise
            .then((unlisten) => {
              if (sessionRef.current !== session || session.stopping) {
                unlisten();
                return;
              }
              session.unlisten.push(unlisten);
            })
            .catch(() => {});
        };

        addUnlisten(
          onFinalTranscript((event) => {
            if (sessionRef.current !== session) return;
            const timelineEvent = session.liveTimelineOffsetMs
              ? {
                  ...event,
                  segments: event.segments.map((segment) => ({
                    ...segment,
                    startMs: segment.startMs + session.liveTimelineOffsetMs,
                    endMs: segment.endMs + session.liveTimelineOffsetMs,
                  })),
                }
              : event;
            if (appendFinalTranscript(timelineEvent, session.lines)) {
              scheduleFlush();
            }
          }),
        );
        addUnlisten(
          listen<{ meetingId?: string | null }>("clips:pill-stop", (event) => {
            const stoppedMeetingId = event.payload?.meetingId;
            if (stoppedMeetingId && stoppedMeetingId !== resolvedMeetingId)
              return;
            stopTranscription("manual").catch(() => {});
          }),
        );
        const autoStopUnlisten = await subscribeAutoStop((reason) => {
          stopTranscription(reason).catch(() => {});
        });
        if (sessionRef.current !== session || session.stopping) {
          autoStopUnlisten();
          throw MEETING_START_CANCELLED;
        }
        session.unlisten.push(autoStopUnlisten);

        if (includeFromMeetingStart && payload.scheduledStart) {
          session.liveTimelineOffsetMs = Math.max(
            0,
            Date.now() - Date.parse(payload.scheduledStart),
          );
        }
        const enginePromise = startTranscriptionEngine({
          mic: { deviceId: selectedMicId, label: selectedMicLabel },
          voiceProcessing: false,
        });
        engineStarting = enginePromise;

        const result = await callClipsAction<{
          meetingId?: string;
          scheduledEnd?: string | null;
          recording?: { id?: string | null } | null;
        }>("start-meeting-recording", { meetingId });
        const resolvedMeetingId = result.meetingId ?? meetingId;
        const recordingId = result.recording?.id;
        session.meetingId = resolvedMeetingId;
        session.recordingId = recordingId ?? null;
        if (!sessionIsActive()) throw MEETING_START_CANCELLED;
        if (!recordingId) {
          throw new Error("Could not create a transcript session.");
        }

        const parsedScheduledEndMs = result.scheduledEnd
          ? Date.parse(result.scheduledEnd)
          : Number.NaN;
        const scheduledEndMs = Number.isFinite(parsedScheduledEndMs)
          ? parsedScheduledEndMs
          : null;

        const silenceDetectorConfig = {
          silenceThreshold: 0.05,
          silenceMs: 15 * 60 * 1000,
          callEndedMs: 30 * 1000,
          callAppBundleIds: callAppBundleIdsForJoinUrl(
            payload.joinUrl,
            payload.platform,
            payload.browserBundleId,
          ),
          scheduledEndMs,
          watchSleep: true,
          watchCallEnded: true,
        };

        const startAudio = async (): Promise<TranscriptionEngine> => {
          const engine = session.engine;
          await restartTranscriptionEngine(
            engine,
            {
              deviceId: selectedMicId,
              label: selectedMicLabel,
            },
            true,
            false,
          );
          return engine;
        };

        const stopStaleAudioTransition = async () => {
          if (sessionRef.current !== session) return;
          await stopTranscriptionEngine(session.engine).catch(() => {});
          if (sessionRef.current !== session) return;
          await invoke("silence_detector_stop").catch(() => {});
        };

        let desiredPaused = false;
        let applyingTransition = false;

        const applyAudioState = async () => {
          if (applyingTransition) return;
          if (sessionRef.current !== session || session.stopping) return;
          if (desiredPaused === session.paused) return;
          applyingTransition = true;
          const transition = (async () => {
            try {
              if (desiredPaused) {
                if (session.flushTimer) {
                  window.clearTimeout(session.flushTimer);
                  session.flushTimer = null;
                }
                await invoke("silence_detector_stop").catch(() => {});
                if (!sessionIsActive()) return;
                try {
                  await stopTranscriptionEngine(session.engine);
                } catch (err) {
                  if (!sessionIsActive()) return;
                  console.warn(
                    "[clips-popover] meeting audio pause failed; staying live:",
                    err,
                  );
                  desiredPaused = false;
                  session.paused = false;
                  await invoke("silence_detector_start", {
                    config: silenceDetectorConfig,
                  }).catch(() => {});
                  if (!sessionIsActive()) await stopStaleAudioTransition();
                  return;
                }
                if (!sessionIsActive()) return;
                await flushTranscript().catch(() => {});
                if (!sessionIsActive()) return;
                session.paused = true;
              } else {
                let resumedEngine: TranscriptionEngine;
                try {
                  resumedEngine = await startAudio();
                } catch (err) {
                  console.warn(
                    "[clips-popover] meeting audio resume failed; staying paused:",
                    err,
                  );
                  if (!sessionIsActive()) return;
                  desiredPaused = true;
                  session.paused = true;
                  return;
                }
                if (!sessionIsActive()) {
                  await stopTranscriptionEngine(resumedEngine).catch(() => {});
                  await stopStaleAudioTransition();
                  return;
                }
                session.paused = false;
                await invoke("silence_detector_start", {
                  config: silenceDetectorConfig,
                }).catch(() => {});
                if (!sessionIsActive()) await stopStaleAudioTransition();
              }
            } finally {
              applyingTransition = false;
            }
          })();
          session.audioTransitionInFlight = transition;
          try {
            await transition;
          } finally {
            if (session.audioTransitionInFlight === transition) {
              session.audioTransitionInFlight = null;
              void applyAudioState();
            }
          }
        };

        const requestAudioState = (paused: boolean) => {
          desiredPaused = paused;
          void applyAudioState();
        };

        addUnlisten(
          listen("clips:recorder-pause", () => {
            requestAudioState(true);
          }),
        );
        addUnlisten(
          listen("clips:recorder-resume", () => {
            requestAudioState(false);
          }),
        );

        pendingPillInitRef.current = {
          meetingId: resolvedMeetingId,
          initialNotes: "",
          starting: true,
        };

        callClipsAction<{
          meeting?: { userNotesMd?: string; title?: string | null };
          transcript?: { segmentsJson?: string | null } | null;
        }>("get-meeting", { id: resolvedMeetingId }, { method: "GET" })
          .then((data) => {
            if (pendingPillInitRef.current?.meetingId !== resolvedMeetingId)
              return;
            const initialNotes = data?.meeting?.userNotesMd ?? "";
            const title = data?.meeting?.title ?? undefined;
            pendingPillInitRef.current = {
              ...pendingPillInitRef.current,
              meetingId: resolvedMeetingId,
              initialNotes,
              title,
              preloadedLines: pillTranscriptLines(session.lines),
            };
            emit("clips:pill-context", {
              meetingId: resolvedMeetingId,
              mode: "meeting",
              title,
              starting: pendingPillInitRef.current.starting,
            }).catch(() => {});
            emit("clips:meeting-notes-init", {
              meetingId: resolvedMeetingId,
              initialNotes,
            }).catch(() => {});

            const segmentsJson = data?.transcript?.segmentsJson;
            if (segmentsJson && sessionRef.current === session) {
              try {
                const segs = JSON.parse(segmentsJson) as Array<{
                  startMs?: number;
                  endMs?: number;
                  text: string;
                  source?: "mic" | "system";
                }>;
                if (segs.length > 0) {
                  const storedLines = segs.map((s) =>
                    transcriptLineFromSegment({
                      startMs: s.startMs ?? 0,
                      endMs: s.endMs ?? 0,
                      text: s.text,
                      source: s.source ?? "mic",
                    }),
                  );
                  session.lines = [...storedLines, ...session.lines];
                  const preloadedLines = pillTranscriptLines(session.lines);
                  if (
                    pendingPillInitRef.current?.meetingId === resolvedMeetingId
                  ) {
                    pendingPillInitRef.current = {
                      ...pendingPillInitRef.current,
                      preloadedLines,
                    };
                  }
                  emit("clips:transcript-preload", {
                    lines: preloadedLines,
                  }).catch(() => {});
                }
              } catch {
                // ignore malformed segmentsJson
              }
            }
          })
          .catch(() => {});

        const startedEngine = await enginePromise;
        engineStarting = null;
        liveEngine = startedEngine;
        if (!sessionIsActive()) {
          await stopTranscriptionEngine(startedEngine).catch(() => {});
          liveEngine = null;
          if (historyPreparedRef.current) {
            invoke("rewind_meeting_history_cancel", {
              token: historyPreparedRef.current.token,
            }).catch(() => {});
          }
          if (session.recordingId) {
            await callClipsAction("stop-meeting-recording", {
              meetingId: session.meetingId,
              reason: "superseded",
            }).catch((err) => {
              console.warn(
                "[clips-popover] could not close a superseded meeting row:",
                err,
              );
            });
          }
          return;
        }
        session.engine = startedEngine;
        if (session.lines.length) scheduleFlush();

        await Promise.all([
          invoke("set_recording_state", { active: true }).catch(() => {}),
          invoke("set_meeting_active", {
            active: true,
            meetingId: resolvedMeetingId,
          }).catch(() => {}),
          invoke("recording_pill_show", {
            meetingId: resolvedMeetingId,
            mode: "meeting",
          }),
        ]);
        if (!sessionIsActive()) throw MEETING_START_CANCELLED;
        if (pendingPillInitRef.current?.meetingId === resolvedMeetingId) {
          pendingPillInitRef.current = {
            ...pendingPillInitRef.current,
            starting: false,
          };
        }
        emit("clips:pill-context", {
          meetingId: resolvedMeetingId,
          mode: "meeting",
          starting: false,
        }).catch(() => {});
        emit("meetings:transcription-started", {
          meetingId: resolvedMeetingId,
        }).catch(() => {});

        if (historyPreparedRef.current) {
          const prepared = historyPreparedRef.current;
          const historyPromise = invoke<{
            segments: SourcedTranscriptSegment[];
          }>("rewind_meeting_history_collect", { token: prepared.token })
            .then((history) => {
              if (sessionRef.current !== session) return;
              const historyLines = history.segments.map(
                transcriptLineFromSegment,
              );
              session.lines = [...historyLines, ...session.lines];
              const preloadedLines = pillTranscriptLines(session.lines);
              if (pendingPillInitRef.current?.meetingId === resolvedMeetingId) {
                pendingPillInitRef.current = {
                  ...pendingPillInitRef.current,
                  preloadedLines,
                };
              }
              emit("clips:transcript-preload", {
                lines: preloadedLines,
              }).catch(() => {});
              flushTranscript().catch((err) => {
                console.warn(
                  "[clips-popover] earlier meeting transcript save failed:",
                  err,
                );
              });
            })
            .catch((error) => {
              const message =
                typeof error === "string"
                  ? error
                  : error instanceof Error
                    ? error.message
                    : "Earlier local meeting audio could not be included.";
              emit("meetings:history-error", {
                meetingId: resolvedMeetingId,
                error: message,
              }).catch(() => {});
            })
            .finally(() => {
              if (session.historyInFlight === historyPromise) {
                session.historyInFlight = null;
              }
            });
          session.historyInFlight = historyPromise;
        }

        if (!sessionIsActive()) throw MEETING_START_CANCELLED;
        await invoke("silence_detector_start", {
          config: silenceDetectorConfig,
        }).catch(() => {});
        if (!sessionIsActive()) {
          if (sessionRef.current === session) {
            await invoke("silence_detector_stop").catch(() => {});
          }
          throw MEETING_START_CANCELLED;
        }

        if (payload.joinUrl && payload.reason !== "user") {
          emit("meetings:open-join-url", {
            joinUrl: payload.joinUrl,
          }).catch(() => {});
        }

        emit("meetings:hide-notification", { meetingId }).catch(() => {});
      } catch (err) {
        if (startedSession) {
          startedSession.stopping = true;
          unlistenAll(startedSession.unlisten.splice(0));
        }
        if (liveEngine) {
          await stopTranscriptionEngine(liveEngine).catch(() => {});
        } else if (engineStarting) {
          // coercion-ok: an engine that never started has nothing to tear
          // down, and null is distinguishable from a started one below. The
          // start failure itself is already being reported by this catch.
          const engine = await engineStarting.catch(() => null);
          if (engine) await stopTranscriptionEngine(engine).catch(() => {});
        }
        if (historyPreparedRef.current) {
          invoke("rewind_meeting_history_cancel", {
            token: historyPreparedRef.current.token,
          }).catch(() => {});
        }
        const superseded =
          sessionRef.current !== null && sessionRef.current !== startedSession;
        if (!superseded) {
          const failedSession = startedSession;
          sessionRef.current = null;
          if (failedSession?.meetingId) {
            await callClipsAction("stop-meeting-recording", {
              meetingId: failedSession.meetingId,
              reason: "start-failed",
            }).catch(() => {});
          }
          pendingPillInitRef.current = null;
          await invoke("recording_pill_hide").catch(() => {});
          await invoke("set_recording_state", { active: false }).catch(
            () => {},
          );
          await invoke("set_meeting_active", { active: false }).catch(() => {});
        } else if (startedSession?.meetingId) {
          await callClipsAction("stop-meeting-recording", {
            meetingId: startedSession.meetingId,
            reason: "superseded",
          }).catch(() => {});
        }
        if (err !== MEETING_START_CANCELLED) {
          const message =
            err instanceof Error ? err.message : "Could not start notes.";
          emit("meetings:transcription-error", {
            meetingId,
            error: message,
          }).catch(() => {});
        }
      }
    },
    [
      callClipsAction,
      flushTranscript,
      selectedMicId,
      selectedMicLabel,
      stopTranscription,
      enabled,
      scheduleRecoveryRetry,
    ],
  );

  const startInFlightRef = useRef<Promise<void> | null>(null);
  const startTranscription = useCallback(
    async (payload: MeetingTranscriptionPayload) => {
      const run = (startInFlightRef.current ?? Promise.resolve())
        .catch(() => {})
        .then(() => runStartTranscription(payload));
      startInFlightRef.current = run;
      try {
        await run;
      } finally {
        if (startInFlightRef.current === run) startInFlightRef.current = null;
      }
    },
    [runStartTranscription],
  );

  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | null = null;
    listen<{ meetingId: string; failedMeetingId: string }>(
      "meetings:replacement-copy-and-start-request",
      (event) => {
        void (async () => {
          const session = sessionRef.current;
          const queuedStart = pendingStartRef.current;
          const isValidRequest = () =>
            session !== null &&
            queuedStart !== null &&
            sessionRef.current === session &&
            pendingStartRef.current === queuedStart &&
            canDiscardTerminalTranscriptForReplacement({
              quitting: quitTeardownPendingRef.current,
              activeMeetingId: session.meetingId,
              failedMeetingId: event.payload.failedMeetingId,
              terminalTranscriptFailure:
                session.stopRecovery?.source === "transcript",
              stopPending: session.stopPending,
              queuedMeetingId: queuedStart.meetingId,
              requestedMeetingId: event.payload.meetingId,
            });
          if (!isValidRequest() || !session || !queuedStart) {
            emit("meetings:replacement-recovery-action-failed", {
              meetingId: event.payload.meetingId,
            }).catch(() => {});
            return;
          }
          const transcript = transcriptFullText(session.lines).trim();
          if (!transcript || !(await writeClipboardText(transcript))) {
            emit("meetings:replacement-recovery-action-failed", {
              meetingId: event.payload.meetingId,
            }).catch(() => {});
            return;
          }
          if (!isValidRequest()) {
            emit("meetings:replacement-recovery-action-failed", {
              meetingId: event.payload.meetingId,
            }).catch(() => {});
            return;
          }

          pendingStartRef.current = null;
          session.stopPending = false;
          session.pendingStopReason = null;
          session.stopRecovery = null;
          sessionRef.current = null;
          recoveryRetryDelayRef.current = RECOVERY_RETRY_INITIAL_MS;
          if (recoveryRetryTimerRef.current) {
            window.clearTimeout(recoveryRetryTimerRef.current);
            recoveryRetryTimerRef.current = null;
          }
          invoke("recording_pill_hide").catch(() => {});
          invoke("set_recording_state", { active: false }).catch(() => {});
          invoke("set_meeting_active", { active: false }).catch(() => {});
          emit("meetings:transcription-stopped", {
            meetingId: session.meetingId,
            reason: "replaced",
          }).catch(() => {});
          startTranscription(queuedStart).catch((error) => {
            console.warn(
              "[clips-popover] queued meeting did not start after transcript copy:",
              error,
            );
          });
        })().catch((error) => {
          console.warn(
            "[clips-popover] could not copy the unsaved meeting transcript:",
            error,
          );
          emit("meetings:replacement-recovery-action-failed", {
            meetingId: event.payload.meetingId,
          }).catch(() => {});
        });
      },
    )
      .then((dispose) => {
        if (stopped) dispose();
        else unlisten = dispose;
      })
      .catch((error) => {
        console.warn(
          "[clips-popover] replacement recovery listener registration failed:",
          error,
        );
      });
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, [startTranscription]);

  const retryPendingWork = useCallback(() => {
    const session = sessionRef.current;
    if (quitTeardownPendingRef.current) {
      stopTranscription("app-quit").catch((error) => {
        console.warn("[clips-popover] queued quit retry failed:", error);
      });
      return;
    }
    const payload = pendingStartRef.current;
    if (payload) {
      startTranscription(payload).catch((error) => {
        console.warn(
          "[clips-popover] queued meeting start retry failed:",
          error,
        );
      });
    } else if (session?.stopPending) {
      stopTranscription(session.pendingStopReason ?? "manual").catch(
        (error) => {
          console.warn("[clips-popover] queued stop retry failed:", error);
        },
      );
    }
  }, [startTranscription, stopTranscription]);

  useEffect(() => {
    retryPendingWorkRef.current = retryPendingWork;
  }, [retryPendingWork]);

  useEffect(
    () => () => {
      if (recoveryRetryTimerRef.current) {
        window.clearTimeout(recoveryRetryTimerRef.current);
        recoveryRetryTimerRef.current = null;
      }
      retryPendingWorkRef.current = null;
    },
    [],
  );

  useEffect(() => {
    let stopped = false;
    let unlistenQuitRequested: (() => void) | null = null;
    let unlistenQuitCancelled: (() => void) | null = null;
    listen("meetings:quit-requested", () => {
      quitTeardownPendingRef.current = true;
      pendingStartRef.current = null;
      recoveryRetryDelayRef.current = RECOVERY_RETRY_INITIAL_MS;
      if (recoveryRetryTimerRef.current) {
        window.clearTimeout(recoveryRetryTimerRef.current);
        recoveryRetryTimerRef.current = null;
      }
      stopTranscription("app-quit").catch((error) => {
        console.warn("[clips-popover] app-quit teardown failed:", error);
      });
    })
      .then((dispose) => {
        if (stopped) dispose();
        else unlistenQuitRequested = dispose;
      })
      .catch((error) => {
        console.warn(
          "[clips-popover] quit listener registration failed:",
          error,
        );
      });
    listen("meetings:quit-cancelled", () => {
      quitTeardownPendingRef.current = false;
    })
      .then((dispose) => {
        if (stopped) dispose();
        else unlistenQuitCancelled = dispose;
      })
      .catch((error) => {
        console.warn(
          "[clips-popover] quit cancellation listener registration failed:",
          error,
        );
      });
    return () => {
      stopped = true;
      unlistenQuitRequested?.();
      unlistenQuitCancelled?.();
    };
  }, [stopTranscription]);

  useEffect(() => {
    if (!enabled) return;
    const unlisteners: Array<() => void> = [];
    let stopped = false;
    const track = (promise: Promise<() => void>) => {
      promise
        .then((unlisten) => {
          if (stopped) {
            unlisten();
            return;
          }
          unlisteners.push(unlisten);
        })
        .catch(() => {});
    };
    track(
      listen<MeetingTranscriptionPayload>(
        "meetings:start-transcription",
        (event) => {
          startTranscription(event.payload).catch((err) => {
            console.error("[clips-popover] start transcription failed:", err);
          });
        },
      ),
    );
    return () => {
      stopped = true;
      unlisteners.forEach((unlisten) => {
        try {
          unlisten();
        } catch {
          // ignore
        }
      });
      unlisteners.length = 0;
    };
  }, [enabled, startTranscription]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const session = sessionRef.current;
      if (!session) {
        if (quitTeardownPendingRef.current) {
          acknowledgeQuitTeardown().catch((error) => {
            console.warn(
              "[clips-popover] quit acknowledgement retry failed:",
              error,
            );
          });
        }
        return;
      }
      if (session.stopPending) {
        if (session.stopRecovery) return;
        stopTranscription(session.pendingStopReason ?? "manual").catch(
          () => {},
        );
        return;
      }
      if (!enabled || session.stopping) return;
      callClipsAction<{ meeting?: { actualEnd?: string | null } }>(
        "get-meeting",
        { id: session.meetingId },
        { method: "GET" },
      )
        .then((data) => {
          if (sessionRef.current !== session || session.stopping) return;
          if (!data?.meeting?.actualEnd) return;
          stopTranscription("server-ended").catch(() => {});
        })
        .catch(() => {
          // Best-effort — a failed poll just waits for the next tick or the
          // native detector.
        });
    }, MEETING_ENDED_POLL_MS);
    return () => window.clearInterval(timer);
  }, [acknowledgeQuitTeardown, callClipsAction, enabled, stopTranscription]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const unlistens: Array<Promise<() => void>> = [];

    let notesSaveController: AbortController | null = null;

    unlistens.push(
      listen<{ meetingId: string; notes: string }>(
        "clips:save-meeting-notes",
        (ev) => {
          notesSaveController?.abort();
          notesSaveController = new AbortController();
          const signal = notesSaveController.signal;
          callClipsAction(
            "update-meeting",
            { id: ev.payload.meetingId, userNotesMd: ev.payload.notes },
            { signal },
          )
            .then(() => {
              emit("clips:meeting-saved", {
                meetingId: ev.payload.meetingId,
                ts: Date.now(),
              }).catch(() => {});
            })
            .catch((err) => {
              if ((err as Error)?.name === "AbortError") return;
              console.warn("[clips-popover] save meeting notes failed:", err);
              emit("clips:meeting-save-failed", {}).catch(() => {});
            });
        },
      ),
    );

    unlistens.push(
      listen("clips:pill-ready", () => {
        const pending = pendingPillInitRef.current;
        if (!pending) return;
        emit("clips:pill-context", {
          meetingId: pending.meetingId,
          mode: "meeting",
          title: pending.title,
          starting: pending.starting === true,
        }).catch(() => {});
        emit("clips:meeting-notes-init", {
          meetingId: pending.meetingId,
          initialNotes: pending.initialNotes,
        }).catch(() => {});
        if (pending.preloadedLines?.length) {
          emit("clips:transcript-preload", {
            lines: pending.preloadedLines,
          }).catch(() => {});
        }
      }),
    );

    unlistens.push(
      listen<{ meetingId: string; openChat?: boolean; prompt?: string }>(
        "clips:open-meeting",
        (ev) => {
          if (!ev.payload?.meetingId) return;
          const params = new URLSearchParams();
          if (ev.payload.openChat) params.set("chat", "1");
          const prompt = ev.payload.prompt?.trim();
          if (prompt) params.set("ask", prompt);
          const query = params.toString();
          openExternal(
            `${normalizedServerUrl}/meetings/${ev.payload.meetingId}${
              query ? `?${query}` : ""
            }`,
          ).catch((err) =>
            console.warn("[clips-popover] open meeting in web failed:", err),
          );
        },
      ),
    );

    return () => {
      stopped = true;
      notesSaveController?.abort();
      unlistens.forEach((p) =>
        p
          .then((u) => {
            if (stopped) u();
          })
          .catch(() => {}),
      );
    };
  }, [callClipsAction, enabled, normalizedServerUrl]);
}
