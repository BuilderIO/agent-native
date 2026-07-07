import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  appendFinalTranscript,
  onFinalTranscript,
  restartTranscriptionEngine,
  speakerFor,
  startTranscriptionEngine,
  stopTranscriptionEngine,
  type SourcedTranscriptSegment,
  type TranscriptionEngine,
} from "../lib/transcription-engine";
import { normalizeServerUrl } from "../lib/url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MeetingTranscriptionPayload {
  meetingId: string;
  joinUrl?: string | null;
  reason?: "user" | "calendar-auto" | string;
}

interface MeetingTranscriptionSession {
  meetingId: string;
  recordingId: string;
  lines: string[];
  segments: SourcedTranscriptSegment[];
  unlisten: Array<() => void>;
  flushTimer: ReturnType<typeof setTimeout> | null;
  stopping: boolean;
  paused: boolean;
  engine: TranscriptionEngine;
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
    preloadedLines?: Array<{
      text: string;
      source: "mic" | "system";
      startMs?: number;
    }>;
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
        fullText: session.lines.join("\n\n"),
        segments: session.segments,
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
        session.unlisten.splice(0).forEach((unlisten) => {
          try {
            unlisten();
          } catch {
            // ignore
          }
        });
        await invoke("silence_detector_stop").catch(() => {});
        // Final flush waits for any in-flight flush first (flushTranscript's
        // single-flight coalescing) then sends the definitive snapshot.
        await flushTranscript().catch((err) => {
          console.warn("[clips-popover] meeting transcript save failed:", err);
        });
        await callClipsAction("stop-meeting-recording", {
          meetingId: session.meetingId,
        }).catch((err) => {
          console.warn("[clips-popover] stop meeting action failed:", err);
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
        // Skip opening the meeting in the browser on app-quit — the app is
        // exiting, there's nothing to hand off to.
        if (reason !== "app-quit") {
          openExternal(
            `${normalizedServerUrl}/meetings/${session.meetingId}`,
          ).catch((err) => {
            console.warn("[clips-popover] open meeting in web failed:", err);
          });
        }
        // Guard the shared Rust-side state writes and sessionRef null-out by
        // identity. App quit and other callers can still race a stop against a
        // new start that slips in between awaits, and stale teardown must not
        // clobber the session that has since taken over.
        if (sessionRef.current === session) {
          await invoke("recording_pill_hide").catch(() => {});
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

  const startTranscription = useCallback(
    async (payload: MeetingTranscriptionPayload) => {
      const meetingId = payload.meetingId;
      if (!meetingId) return;

      const existing = sessionRef.current;
      if (existing) {
        if (!existing.stopping && existing.meetingId === meetingId) {
          emit("meetings:hide-notification", { meetingId }).catch(() => {});
          return;
        }
        // Always await the existing teardown before starting a new session,
        // even if it is already stopping. stopTranscription coalesces through
        // stopInFlightRef, so awaiting an already-stopping session joins the
        // in-flight promise instead of running teardown twice.
        await stopTranscription("replaced");
      }

      try {
        const result = await callClipsAction<{
          meetingId?: string;
          recording?: { id?: string | null } | null;
        }>("start-meeting-recording", { meetingId });
        const resolvedMeetingId = result.meetingId ?? meetingId;
        const recordingId = result.recording?.id;
        if (!recordingId) {
          throw new Error("Could not create a transcript session.");
        }

        const session: MeetingTranscriptionSession = {
          meetingId: resolvedMeetingId,
          recordingId,
          lines: [],
          segments: [],
          unlisten: [],
          flushTimer: null,
          stopping: false,
          paused: false,
          engine: "whisper",
          flushInFlight: null,
          flushSeq: 0,
          dirtySeq: 0,
        };
        sessionRef.current = session;
        await invoke("set_recording_state", { active: true }).catch(() => {});
        await invoke("set_meeting_active", { active: true }).catch(() => {});

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
            if (appendFinalTranscript(event, session.lines, session.segments)) {
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
        addUnlisten(
          listen("meetings:silence-stop", () => {
            stopTranscription("silence").catch(() => {});
          }),
        );
        addUnlisten(
          listen("meetings:sleep-stop", () => {
            stopTranscription("sleep").catch(() => {});
          }),
        );
        addUnlisten(
          listen("meetings:call-ended", () => {
            stopTranscription("call-ended").catch(() => {});
          }),
        );

        const silenceDetectorConfig = {
          silenceThreshold: 0.05,
          silenceMs: 15 * 60 * 1000,
          callEndedMs: 2 * 60 * 1000,
          watchSleep: true,
          watchCallEnded: true,
        };

        // Resume the engine that initial start settled on (no fallback here —
        // the engine choice was already made below).
        const startAudio = async () => {
          await restartTranscriptionEngine(session.engine, {
            deviceId: selectedMicId,
            label: selectedMicLabel,
          });
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

        // Pill init — set synchronously before the pill mounts so pill-ready
        // re-emit has meetingId available immediately.
        pendingPillInitRef.current = {
          meetingId: resolvedMeetingId,
          initialNotes: "",
        };

        await invoke("recording_pill_show", {
          meetingId: resolvedMeetingId,
          mode: "meeting",
        });

        // Immediate emit covers the reused-window case (pill already mounted).
        emit("clips:pill-context", {
          meetingId: resolvedMeetingId,
          mode: "meeting",
        }).catch(() => {});

        callClipsAction<{
          meeting?: { userNotesMd?: string };
          transcript?: { segmentsJson?: string | null } | null;
        }>("get-meeting", { id: resolvedMeetingId }, { method: "GET" })
          .then((data) => {
            // Guard: if the session changed while the fetch was in-flight
            // (user switched meetings), don't overwrite the new meeting's
            // pending context with stale data.
            if (pendingPillInitRef.current?.meetingId !== resolvedMeetingId)
              return;
            const initialNotes = data?.meeting?.userNotesMd ?? "";
            pendingPillInitRef.current = {
              meetingId: resolvedMeetingId,
              initialNotes,
            };
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
                  const preloadedLineStrings = segs.map(
                    (s) => `${speakerFor(s.source)}: ${s.text}`,
                  );
                  const preloadedSegments = segs.map((s) => ({
                    startMs: s.startMs ?? 0,
                    endMs: s.endMs ?? 0,
                    text: s.text,
                    source: s.source ?? ("mic" as const),
                  }));
                  session.lines = [...preloadedLineStrings, ...session.lines];
                  session.segments = [
                    ...preloadedSegments,
                    ...session.segments,
                  ];
                  const preloadedLines = segs.map((s) => ({
                    text: s.text,
                    source: (s.source ?? "mic") as "mic" | "system",
                    startMs: s.startMs,
                  }));
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

        session.engine = await startTranscriptionEngine({
          mic: { deviceId: selectedMicId, label: selectedMicLabel },
        });

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
        sessionRef.current = null;
        await invoke("recording_pill_hide").catch(() => {});
        await invoke("set_recording_state", { active: false }).catch(() => {});
        await invoke("set_meeting_active", { active: false }).catch(() => {});
        const message =
          err instanceof Error ? err.message : "Could not start notes.";
        emit("meetings:transcription-error", {
          meetingId,
          error: message,
        }).catch(() => {});
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
      listen<{ meetingId: string }>("clips:open-meeting", (ev) => {
        if (!ev.payload?.meetingId) return;
        openExternal(
          `${normalizedServerUrl}/meetings/${ev.payload.meetingId}`,
        ).catch((err) =>
          console.warn("[clips-popover] open meeting in web failed:", err),
        );
      }),
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
