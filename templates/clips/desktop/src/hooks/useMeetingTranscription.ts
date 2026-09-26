import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { callAppBundleIdsForJoinUrl } from "../lib/meeting-call-app";
import { stopMeetingBeforeTranscriptFlush } from "../lib/meeting-stop";
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
      await callClipsAction("save-browser-transcript", {
        recordingId: session.recordingId,
        fullText: transcriptFullText(session.lines),
        segments: transcriptSegments(session.lines),
        source: session.engine,
        overwriteReady: true,
      });
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


  const stopInFlightRef = useRef<Promise<void> | null>(null);

  const stopTranscription = useCallback(
    async (reason: string = "manual") => {
      const session = sessionRef.current;
      if (!session) return;
      if (session.stopping) {
        await stopInFlightRef.current;
        return;
      }
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
        await stopMeetingBeforeTranscriptFlush({
          stopRecording: async () => {
            await callClipsAction("stop-meeting-recording", {
              meetingId: session.meetingId,
              reason,
            }).catch((err) => {
              console.warn("[clips-popover] stop meeting action failed:", err);
            });
          },
          waitForHistory: async () => {
            if (reason !== "app-quit") {
              await session.historyInFlight?.catch(() => {});
            }
          },
          flushTranscript: async () => {
            await flushTranscript().catch((err) => {
              console.warn(
                "[clips-popover] meeting transcript save failed:",
                err,
              );
            });
          },
        });
        if (session.lines.length) {
          const finalizePromise = callClipsAction("finalize-meeting", {
            meetingId: session.meetingId,
          }).catch((err) => {
            console.warn("[clips-popover] finalize meeting failed:", err);
          });
          if (reason !== "app-quit") await finalizePromise;
        }
        if (sessionRef.current === session) {
          if (reason === "app-quit" || reason === "replaced") {
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
          reason,
        }).catch(() => {});
      })();
      stopInFlightRef.current = run;
      try {
        await run;
      } finally {
        if (stopInFlightRef.current === run) stopInFlightRef.current = null;
      }
    },
    [callClipsAction, flushTranscript, normalizedServerUrl],
  );

  useEffect(() => {
    if (enabled) return;
    stopTranscription("lab-disabled").catch(() => {});
  }, [enabled, stopTranscription]);


  const runStartTranscription = useCallback(
    async (payload: MeetingTranscriptionPayload) => {
      if (!enabled) return;
      const meetingId = payload.meetingId;
      if (!meetingId) return;

      const existing = sessionRef.current;
      if (existing) {
        if (!existing.stopping && existing.meetingId === meetingId) {
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
        await stopTranscription("replaced");
      }

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
        addUnlisten(
          listen("meetings:quit-requested", () => {
            stopTranscription("app-quit")
              .catch((err) => {
                console.warn("[clips-popover] app-quit teardown failed:", err);
              })
              .finally(() => {
                invoke("quit_teardown_done").catch(() => {});
              });
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
          callAppBundleIds: callAppBundleIdsForJoinUrl(payload.joinUrl),
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
    if (!enabled) return;
    const timer = window.setInterval(() => {
      const session = sessionRef.current;
      if (!session || session.stopping) return;
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
  }, [callClipsAction, enabled, stopTranscription]);

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
