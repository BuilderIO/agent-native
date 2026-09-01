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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MeetingTranscriptionPayload {
  meetingId: string;
  joinUrl?: string | null;
  reason?: "user" | "calendar-auto" | (string & {});
  scheduledStart?: string | null;
  includeFromMeetingStart?: boolean;
}

interface MeetingTranscriptionSession {
  meetingId: string;
  /** Null until `start-meeting-recording` answers. Live audio starts in
   *  parallel with that call, so early lines buffer until there is a row to
   *  save them to — see the flush guard. */
  recordingId: string | null;
  lines: TranscriptLine[];
  unlisten: Array<() => void>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  stopping: boolean;
  paused: boolean;
  engine: TranscriptionEngine;
  /** Offset local live-engine timestamps onto the scheduled meeting timeline. */
  liveTimelineOffsetMs: number;
  historyInFlight: Promise<void> | null;
  // Single-flight flush bookkeeping (M3): `flushInFlight` is the promise of
  // the currently-running save-browser-transcript call (or null). `flushSeq`
  // is bumped every time flushTranscript is invoked; `dirtySeq` records the
  // seq of the most recent *request* to flush. A completed flush only clears
  // its own dirty marker if no newer flush was requested while it was in
  // flight — otherwise it re-flushes with the latest snapshot.
  flushInFlight: Promise<void> | null;
  flushSeq: number;
  dirtySeq: number;
}

/** What the pill overlay needs to render a line: text, side, and timestamp.
 *  The verbatim segments stay behind in the session. */
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
}

const MEETING_START_CANCELLED = Symbol("meeting-start-cancelled");

function unlistenAll(unlisteners: Array<() => void>): void {
  for (const unlisten of unlisteners) {
    try {
      unlisten();
    } catch {
      continue;
    }
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMeetingTranscription({
  callClipsAction,
  serverUrl,
  selectedMicId,
  selectedMicLabel,
}: Props): void {
  const sessionRef = useRef<MeetingTranscriptionSession | null>(null);
  const pendingPillInitRef = useRef<{
    meetingId: string;
    initialNotes: string;
    title?: string;
    preloadedLines?: PillTranscriptLine[];
    /** The pill is on screen but capture has not attached yet. */
    starting?: boolean;
  } | null>(null);

  const normalizedServerUrl = useMemo(
    () => normalizeServerUrl(serverUrl),
    [serverUrl],
  );

  // -------------------------------------------------------------------------
  // Transcript flush
  // -------------------------------------------------------------------------

  // Coalescing single-flight flush (M3): only ever one save-browser-transcript
  // request in flight per session. A flush requested while one is already
  // outstanding marks the session dirty and re-runs after the in-flight call
  // settles, using whatever lines/segments are current at that later time —
  // this prevents a stale, smaller snapshot from a slower request landing
  // after (and clobbering) a newer, larger one.
  const flushTranscript = useCallback(async (): Promise<void> => {
    const session = sessionRef.current;
    if (!session) return;
    // No row yet: lines keep accumulating and the flush that follows the row's
    // arrival writes all of them. Saving against a null id would 400.
    if (!session.recordingId) return;
    session.dirtySeq = session.flushSeq + 1;
    if (session.flushInFlight) {
      // A flush is already outstanding — wait for it (and any chained
      // re-flush it triggers for our own dirty marker) instead of firing a
      // second overlapping request.
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
      // Newer content arrived while this request was in flight — chain a
      // re-flush with the latest snapshot before this call resolves, so
      // every awaiter (including the coalesced branch above) sees the
      // definitive result.
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

  // -------------------------------------------------------------------------
  // Stop
  // -------------------------------------------------------------------------

  // Promise of the currently-running teardown, so a second stop request
  // (e.g. app-quit arriving during a silence-stop) waits for the in-flight
  // teardown to finish instead of returning before the final flush landed.
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
        try {
          await stopTranscriptionEngine(session.engine);
        } catch (err) {
          console.warn("[clips-popover] meeting audio stop failed:", err);
        }
        unlistenAll(session.unlisten.splice(0));
        await invoke("silence_detector_stop").catch(() => {});
        await stopMeetingBeforeTranscriptFlush({
          // Stamp actualEnd as soon as capture is torn down. Transcript
          // history and network flushes may be slow or unavailable, but they
          // must not leave the meeting looking live in the meantime.
          stopRecording: async () => {
            await callClipsAction("stop-meeting-recording", {
              meetingId: session.meetingId,
            }).catch((err) => {
              console.warn("[clips-popover] stop meeting action failed:", err);
            });
          },
          waitForHistory: async () => {
            if (reason !== "app-quit") {
              await session.historyInFlight?.catch(() => {});
            }
          },
          // Final flush waits for any in-flight flush first
          // (flushTranscript's single-flight coalescing) and sends the
          // definitive snapshot.
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
          // App-quit teardown must not block on the network round-trip — the
          // server completes finalize independently, and the web app's
          // auto-finalize effect is the fallback if this fire-and-forget call
          // never lands.
          if (reason !== "app-quit") await finalizePromise;
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

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  const runStartTranscription = useCallback(
    async (payload: MeetingTranscriptionPayload) => {
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
        // Always await the existing teardown before starting a new session,
        // even if it is already stopping. stopTranscription coalesces through
        // stopInFlightRef, so awaiting an already-stopping session joins the
        // in-flight promise instead of running teardown twice.
        await stopTranscription("replaced");
      }

      // Put the pill on screen before any of the work behind it — the row
      // creation, the ScreenCaptureKit query, the engine start. Every one of
      // those used to run with nothing on screen, which is the whole of the
      // delay between the click and the note taker appearing.
      //
      // It shows as `starting`, not recording: the indicator, the tray state,
      // and the meeting-active flag still wait for capture to actually attach,
      // so a failed start never leaves a pill claiming it recorded anything.
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
      // The pill has taken over the feedback; the dialog has nothing left to
      // report and used to sit there for the whole startup.
      emit("meetings:hide-notification", { meetingId }).catch(() => {});

      // Held so a failure downstream can tear the engine back down. Two
      // variables because startup keeps going after the engine is up: while it
      // is still coming up only the promise exists, and once it has resolved
      // the promise is no longer the thing to stop. A failure at any point
      // after this must close whichever one is live, or the microphone stays
      // open for a meeting that never started.
      let engineStarting: Promise<TranscriptionEngine> | null = null;
      let liveEngine: TranscriptionEngine | null = null;
      // Held outside the try so the failure path can tell "my session" from
      // "whatever session is current now", which a newer start may own.
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
          liveTimelineOffsetMs: 0,
          historyInFlight: null,
          flushInFlight: null,
          flushSeq: 0,
          dirtySeq: 0,
        };
        sessionRef.current = session;
        startedSession = session;

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
          // Rust only emits this at app-quit while MeetingActive is true (see
          // lib.rs's ExitRequested handler). Run the graceful teardown, then
          // tell Rust we're done so it can let the process exit — a 3s
          // watchdog on the Rust side forces exit regardless if this never
          // fires (dead webview, hung network call).
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
        // Register every native auto-stop listener before starting audio. The
        // Tauri listen calls are async; firing the detector first leaves a
        // small but real window where a native end event can be missed.
        const autoStopUnlisten = await subscribeAutoStop((reason) => {
          stopTranscription(reason).catch(() => {});
        });
        if (sessionRef.current !== session || session.stopping) {
          autoStopUnlisten();
          // Route stale startup through the existing cleanup path so a
          // replacement cannot leave a microphone or server row behind.
          throw MEETING_START_CANCELLED;
        }
        session.unlisten.push(autoStopUnlisten);

        // Creating the row and starting the audio engine need nothing from each
        // other — only the flush needs a recording id. Kicking the engine here
        // takes the network round trip off the critical path; the transcript
        // listeners above are already attached, so a line spoken during the
        // overlap is buffered rather than dropped.
        // Set before capture can produce anything. The final-transcript
        // listener stamps each event with this offset as it arrives, so an
        // event that lands while the offset is still 0 is written on the local
        // clock while its neighbours are written on the meeting's — one
        // transcript on two timelines. Anchoring here costs the engine's warmup
        // in accuracy and is what the pre-parallel code did.
        if (includeFromMeetingStart && payload.scheduledStart) {
          session.liveTimelineOffsetMs = Math.max(
            0,
            Date.now() - Date.parse(payload.scheduledStart),
          );
        }
        const enginePromise = startTranscriptionEngine({
          mic: { deviceId: selectedMicId, label: selectedMicLabel },
          // macOS 15+ uses ScreenCaptureKit's independent microphone output.
          // Rust upgrades only the legacy/failure fallback to bypassed VPIO so
          // call apps cannot starve Clips of mic buffers or lose call volume.
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
        if (!recordingId) {
          throw new Error("Could not create a transcript session.");
        }
        session.meetingId = resolvedMeetingId;
        session.recordingId = recordingId;

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

        // Resume the engine that initial start settled on (no fallback here —
        // the engine choice was already made below). Rust prefers one combined
        // SCK stream and uses bypassed VoiceProcessingIO only for legacy/failure
        // fallback, so the transcript stays live without changing call volume.
        const startAudio = async () => {
          await restartTranscriptionEngine(
            session.engine,
            {
              deviceId: selectedMicId,
              label: selectedMicLabel,
            },
            true,
            false,
          );
        };

        // Pause/resume state machine — see app.tsx for full explanation.
        let desiredPaused = false;
        let applyingTransition = false;

        const applyAudioState = async () => {
          if (applyingTransition) return;
          if (sessionRef.current !== session || session.stopping) return;
          if (desiredPaused === session.paused) return;
          applyingTransition = true;
          try {
            if (desiredPaused) {
              if (session.flushTimer) {
                window.clearTimeout(session.flushTimer);
                session.flushTimer = null;
              }
              await invoke("silence_detector_stop").catch(() => {});
              try {
                await stopTranscriptionEngine(session.engine);
              } catch (err) {
                console.warn(
                  "[clips-popover] meeting audio pause failed; staying live:",
                  err,
                );
                desiredPaused = false;
                session.paused = false;
                await invoke("silence_detector_start", {
                  config: silenceDetectorConfig,
                }).catch(() => {});
                return;
              }
              await flushTranscript().catch(() => {});
              session.paused = true;
            } else {
              try {
                await startAudio();
              } catch (err) {
                console.warn(
                  "[clips-popover] meeting audio resume failed; staying paused:",
                  err,
                );
                desiredPaused = true;
                session.paused = true;
                return;
              }
              session.paused = false;
              await invoke("silence_detector_start", {
                config: silenceDetectorConfig,
              }).catch(() => {});
            }
          } finally {
            applyingTransition = false;
            // Re-check for any desiredPaused change queued while this
            // transition was in flight — including the two early-return
            // error-recovery branches above, which otherwise skipped this
            // reconvergence and could leave a queued pause/resume request
            // unapplied until another external event happened to fire.
            void applyAudioState();
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

        // Prepare the pill payload before live audio starts, but don't show a
        // recording indicator or publish an active meeting until the engine
        // has actually acquired its audio source. This keeps "Recording"
        // truthful when model/capture startup fails.
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
            // Guard: if the session changed while the fetch was in-flight
            // (user switched meetings), don't overwrite the new meeting's
            // pending context with stale data.
            if (pendingPillInitRef.current?.meetingId !== resolvedMeetingId)
              return;
            const initialNotes = data?.meeting?.userNotesMd ?? "";
            const title = data?.meeting?.title ?? undefined;
            // Spread rather than rebuild: this ref is what `clips:pill-ready`
            // replays into a window that mounts later, and only the engine-start
            // path is allowed to clear `starting`. Rebuilding it here dropped
            // that flag, so a pill reloaded during startup came up showing a
            // live meter and transport for capture that had not attached.
            pendingPillInitRef.current = {
              ...pendingPillInitRef.current,
              meetingId: resolvedMeetingId,
              initialNotes,
              title,
              preloadedLines: pillTranscriptLines(session.lines),
            };
            // A pill that mounted before this fetch resolved learns the
            // meeting title here; same meetingId+mode means the pill applies
            // it without resetting its session state.
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

            // Preload any existing transcript segments into the pill and session.
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
                  // Store in ref so clips:pill-ready can re-emit if the
                  // pill window mounts after this fetch resolves.
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
        // A newer start can have replaced this session while the row creation
        // and the engine were in flight — `stopTranscription` tore this one
        // down against `session.engine`, which was still the placeholder,
        // so the engine that just came up belongs to nobody. Publishing the
        // tray, indicator, and pill state below would repoint all three at the
        // meeting the user just left. Every other continuation in this function
        // guards the same way.
        if (sessionRef.current !== session) {
          await stopTranscriptionEngine(startedEngine).catch(() => {});
          liveEngine = null;
          if (historyPreparedRef.current) {
            invoke("rewind_meeting_history_cancel", {
              token: historyPreparedRef.current.token,
            }).catch(() => {});
          }
          // The teardown that replaced this session ran while the row was
          // still being created, so its own `stop-meeting-recording` either
          // hit nothing or stopped a row that did not exist yet. Closing the
          // row here is the only chance left — otherwise the meeting stays
          // recording server-side with no client attached to it.
          if (session.recordingId) {
            await callClipsAction("stop-meeting-recording", {
              meetingId: session.meetingId,
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
        // Anything captured while the row was still being created has a home
        // now, so write it before the first idle flush would have.
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
        if (pendingPillInitRef.current?.meetingId === resolvedMeetingId) {
          pendingPillInitRef.current = {
            ...pendingPillInitRef.current,
            starting: false,
          };
        }
        // Immediate emit covers the reused-window case (pill already mounted).
        // `starting: false` is what flips the pill from waiting to recording.
        emit("clips:pill-context", {
          meetingId: resolvedMeetingId,
          mode: "meeting",
          starting: false,
        }).catch(() => {});
        emit("meetings:transcription-started", {
          meetingId: resolvedMeetingId,
        }).catch(() => {});

        // Indexing the fenced local fragment can take tens of seconds. It runs
        // after live capture is active, then prepends its bounded rows into the
        // same canonical session. A local-index failure is visible but never
        // tears down notes that are already recording.
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

        await invoke("silence_detector_start", {
          config: silenceDetectorConfig,
        }).catch(() => {});

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
        // The engine can be live even though the start failed: it runs in
        // parallel with the row creation, and startup continues for a while
        // after it comes up. Leaving it would hold the microphone for a session
        // that does not exist. Whichever of the two is live gets stopped —
        // `liveEngine` once the promise resolved, the promise itself before
        // that. Checking only the promise let every failure after the engine
        // was up orphan it.
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
        // A newer start may have taken over while this one was failing. It owns
        // the session ref, the pill, and the tray state now, so tearing those
        // down here would stop a meeting that is recording fine — the same
        // identity guard `stopTranscription` uses for its shared writes.
        const superseded =
          sessionRef.current !== null && sessionRef.current !== startedSession;
        if (!superseded) {
          const failedSession = startedSession;
          sessionRef.current = null;
          if (failedSession?.meetingId) {
            await callClipsAction("stop-meeting-recording", {
              meetingId: failedSession.meetingId,
            }).catch(() => {});
          }
          pendingPillInitRef.current = null;
          await invoke("recording_pill_hide").catch(() => {});
          await invoke("set_recording_state", { active: false }).catch(
            () => {},
          );
          await invoke("set_meeting_active", { active: false }).catch(() => {});
        } else if (startedSession?.meetingId) {
          // This session's row still needs closing even though the globals
          // belong to the newer one.
          await callClipsAction("stop-meeting-recording", {
            meetingId: startedSession.meetingId,
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
    ],
  );

  /**
   * One start at a time.
   *
   * `sessionRef` is only claimed part-way through the sequence above, so two
   * starts arriving close together — a reminder click racing the calendar
   * auto-start, or a double-fired event — both saw no existing session, and
   * each created a recording row and an audio engine. Only one could own
   * `sessionRef`; the other's capture ran with nothing left to stop it, and its
   * row was never closed.
   *
   * Serializing is what makes the existing checks mean anything: the second
   * start now sees the first's session and either adopts it (same meeting) or
   * replaces it through `stopTranscription`, which is the path that tears the
   * first one down properly.
   */
  const startInFlightRef = useRef<Promise<void> | null>(null);
  const startTranscription = useCallback(
    async (payload: MeetingTranscriptionPayload) => {
      const previous = startInFlightRef.current;
      const run = (async () => {
        // A failed start must not stop the next one from running.
        if (previous) await previous.catch(() => {});
        await runStartTranscription(payload);
      })();
      startInFlightRef.current = run;
      try {
        await run;
      } finally {
        if (startInFlightRef.current === run) startInFlightRef.current = null;
      }
    },
    [runStartTranscription],
  );

  // -------------------------------------------------------------------------
  // Event listeners
  // -------------------------------------------------------------------------

  useEffect(() => {
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
  }, [startTranscription]);

  useEffect(() => {
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
  }, [callClipsAction, normalizedServerUrl]);
}
