import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconExternalLink,
  IconLoader2,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";

import { isDirectPillClick, type ScreenPoint } from "../lib/pill-interaction";
import { speakerFor, type TranscriptLine } from "../lib/transcription-engine";
import { LiveAudioBars } from "./live-audio-bars";
import { LiveTranscript, type FinalLine } from "./live-transcript";
import { PillLogo } from "./pill-logo";

type PillMode = "meeting" | "clip";

interface PillContext {
  meetingId?: string | null;
  mode?: PillMode;
}

/**
 * Granola-style recording indicator. A floating pill anchored by Rust:
 * center-right for meetings, bottom-center for ordinary recordings.
 *
 *   - Collapsed (default): logo + live waveform capsule, click to expand.
 *   - Expanded: header + scrolling live transcript + Pause / Stop + Ask bar.
 *
 * The hosting Tauri window is always-on-top, transparent, no decorations,
 * and capture-excluded — see `recording_indicator.rs`. We only deal with
 * sizing the window when the user toggles the chevron.
 */
export function RecordingPill() {
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [ctx, setCtx] = useState<PillContext>({ mode: "clip" });
  const ctxRef = useRef<PillContext>({ mode: "clip" });
  const [stopping, setStopping] = useState(false);
  const [finishedMeetingId, setFinishedMeetingId] = useState<string | null>(
    null,
  );
  const finished = finishedMeetingId !== null;
  const [error, setError] = useState<string | null>(null);
  const transcriptLinesRef = useRef<TranscriptLine[]>([]);
  const [hasTranscriptLines, setHasTranscriptLines] = useState(false);
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const [preloadedLines, setPreloadedLines] = useState<FinalLine[]>([]);
  const [ask, setAsk] = useState("");
  const activeMeetingIdRef = useRef<string | null>(null);
  // Detached / "floating" mode — Wispr-style pill that auto-moves to the
  // top-right when the main app loses focus, with a drag handle. Driven by
  // the `clips:pill-detached` event from Rust (toggled by JS via
  // `recording_pill_set_detached`).
  const [detached, setDetached] = useState(false);
  // Driven by the Rust-side global cursor poll (`clips:pill-hover`). macOS only
  // delivers hover events to the key window, so while another app is focused
  // CSS `:hover` never fires on the pill — we mirror the polled state into a
  // class and key the hover styling off that too.
  const [hovered, setHovered] = useState(false);
  const startedAtRef = useRef<number>(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mic and system audio share one calm activity meter, matching Granola's
  // single indicator for the combined meeting capture.
  const stopFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartScreenPointRef = useRef<ScreenPoint | null>(null);

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let stopped = false;
    const trackListen = (p: Promise<() => void>) => {
      p.then((u) => {
        if (stopped) {
          try {
            u();
          } catch {
            // ignore
          }
          return;
        }
        unlistens.push(u);
      }).catch(() => {});
    };
    trackListen(
      listen<PillContext>("clips:pill-context", (ev) => {
        const next: PillContext = {
          meetingId: ev.payload?.meetingId ?? null,
          mode: ev.payload?.mode ?? "clip",
        };
        const prev = ctxRef.current;
        const isSameSession =
          prev.meetingId === next.meetingId && prev.mode === next.mode;
        ctxRef.current = next;
        setCtx(next);
        // The Rust side re-shows (and re-emits this event for) the same pill
        // window whenever the tray icon re-triggers `recording_pill_show`
        // (e.g. toggling the popover) while a meeting is already in progress.
        // Only reset session state below when the meeting/mode actually
        // changed — otherwise an in-progress meeting's timer, transcript, and
        // transcript would wipe out on every tray click.
        if (isSameSession) return;
        // Reset timer on new context.
        startedAtRef.current = Date.now();
        setElapsed(0);
        setPaused(false);
        // The Rust side reuses the pill window across recordings, so the
        // component never unmounts. Reset stop state explicitly when a
        // new recording session begins, otherwise the Stop button stays
        // disabled and a stale fallback timer can fire mid-session.
        setStopping(false);
        setFinishedMeetingId(null);
        setError(null);
        setExpanded(false);
        // Reset transcript state for the new session.
        setPreloadedLines([]);
        activeMeetingIdRef.current =
          ev.payload?.mode === "meeting" ? (next.meetingId ?? null) : null;
        if (stopFallbackRef.current) {
          clearTimeout(stopFallbackRef.current);
          stopFallbackRef.current = null;
        }
      }),
    );
    trackListen(
      listen<{ paused: boolean; elapsedMs: number }>(
        "clips:recorder-state",
        (ev) => {
          // Meeting capture has its own optimistic pause state. Ordinary clips
          // follow the recorder's authoritative broadcast so this reused pill
          // cannot drift or emit an inverted command.
          if (ctxRef.current.mode !== "clip") return;
          setPaused(!!ev.payload.paused);
          setElapsed(
            Math.max(0, Math.floor((ev.payload.elapsedMs ?? 0) / 1000)),
          );
        },
      ),
    );
    trackListen(
      listen<{ lines: FinalLine[] }>("clips:transcript-preload", (ev) => {
        const lines = ev.payload?.lines;
        if (lines?.length) setPreloadedLines(lines);
      }),
    );
    trackListen(
      listen<{ meetingId?: string | null; reason?: string }>(
        "meetings:transcription-stopped",
        (ev) => {
          const reason = ev.payload?.reason;
          // "replaced" hands straight over to the next session and "app-quit"
          // is tearing the window down — neither has a user left to read this.
          if (reason === "replaced" || reason === "app-quit") return;
          if (ctxRef.current.mode !== "meeting") return;
          const meetingId = ev.payload?.meetingId ?? activeMeetingIdRef.current;
          if (!meetingId) return;
          showFinished(meetingId);
        },
      ),
    );
    trackListen(
      listen<{ error: string }>("pill:error", (ev) => {
        setError(ev.payload?.error ?? "An error occurred.");
      }),
    );
    trackListen(
      listen<{ hovered: boolean }>("clips:pill-hover", (ev) => {
        setHovered(!!ev.payload?.hovered);
      }),
    );
    trackListen(
      listen<{ detached: boolean }>("clips:pill-detached", (ev) => {
        setDetached(!!ev.payload?.detached);
        // Detached pill auto-collapses — there's not enough room for the
        // expanded transcript view in the small floating footprint.
        if (ev.payload?.detached) setExpanded(false);
      }),
    );
    // Signal that all listeners are registered. app.tsx listens for this and
    // re-emits the pill context and transcript preload for a fresh window.
    emit("clips:pill-ready", {}).catch(() => {});
    return () => {
      stopped = true;
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
      if (stopFallbackRef.current) {
        clearTimeout(stopFallbackRef.current);
        stopFallbackRef.current = null;
      }
    };
  }, []);

  // Elapsed timer.
  useEffect(() => {
    // Clip recordings already broadcast their pause-aware elapsed time every
    // 500ms. Keep the local wall clock only for meeting mode.
    if (paused || finished || ctx.mode === "clip") return;
    tickRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [ctx.mode, finished, paused]);

  async function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    try {
      await invoke("recording_pill_expand", { expanded: next });
    } catch {
      // ignore — best effort
    }
  }

  async function onPauseClick() {
    const nextPaused = !paused;
    if (ctxRef.current.mode === "meeting") setPaused(nextPaused);
    emit(nextPaused ? "clips:recorder-pause" : "clips:recorder-resume").catch(
      () => {},
    );
  }

  function showFinished(meetingId: string) {
    if (stopFallbackRef.current) {
      clearTimeout(stopFallbackRef.current);
      stopFallbackRef.current = null;
    }
    setStopping(false);
    setFinishedMeetingId(meetingId);
    setExpanded(true);
    invoke("recording_pill_expand", { expanded: true }).catch(() => {});
  }

  async function onStopClick() {
    if (stopping) return;
    const meetingId = ctx.meetingId ?? activeMeetingIdRef.current;
    emit("clips:pill-stop", { meetingId: ctx.meetingId ?? null }).catch(
      () => {},
    );
    // Meetings keep the pill up and switch it to the finished banner right
    // away. Teardown (final flush, finalize) runs for seconds afterwards, so
    // waiting on `meetings:transcription-stopped` would leave the pill looking
    // stuck; the banner is what the user acts on, not the save.
    if (ctxRef.current.mode === "meeting" && meetingId) {
      showFinished(meetingId);
      return;
    }
    setStopping(true);
    stopFallbackRef.current = setTimeout(() => {
      invoke("recording_pill_hide").catch(() => {});
    }, 3_000);
  }

  // Stable callback for LiveTranscript to push locked-in lines up. Stable
  // identity matters — it's a dep of an effect inside LiveTranscript.
  const handleTranscriptLines = useCallback((lines: TranscriptLine[]) => {
    transcriptLinesRef.current = lines;
    setHasTranscriptLines(lines.length > 0);
  }, []);

  const handleCopyTranscript = async () => {
    const lines = transcriptLinesRef.current;
    if (!lines.length) return;
    const text = lines
      .map((l) => `${speakerFor(l.source)}: ${l.text}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setTranscriptCopied(true);
      setTimeout(() => setTranscriptCopied(false), 1500);
    } catch {
      // ignore — clipboard may be unavailable in this window
    }
  };

  const handleAskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const question = ask.trim();
    const mid = activeMeetingIdRef.current;
    if (!question || !mid) return;
    setAsk("");
    emit("clips:open-meeting", {
      meetingId: mid,
      openChat: true,
      prompt: question,
    }).catch(() => {});
  };

  const handlePillMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    dragStartScreenPointRef.current = { x: e.screenX, y: e.screenY };
    getCurrentWindow()
      .startDragging()
      .catch((err) => {
        console.warn("[clips-pill] startDragging failed", err);
      });
  };

  const handlePillMediaClick = (e: React.MouseEvent) => {
    const start = dragStartScreenPointRef.current;
    dragStartScreenPointRef.current = null;
    if (!isDirectPillClick(start, { x: e.screenX, y: e.screenY })) return;
    void toggleExpanded();
  };

  const handlePillMouseUp = (e: React.MouseEvent) => {
    const start = dragStartScreenPointRef.current;
    if (isDirectPillClick(start, { x: e.screenX, y: e.screenY })) return;
    void invoke("recording_pill_save_position").catch((err) => {
      console.warn("[clips-pill] save position failed", err);
    });
  };

  const closeFinished = (openMeeting: boolean) => {
    if (openMeeting && finishedMeetingId) {
      emit("clips:open-meeting", { meetingId: finishedMeetingId }).catch(
        () => {},
      );
    }
    invoke("recording_pill_hide").catch(() => {});
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const stopLabel =
    ctx.mode === "meeting" ? "Stop transcription" : "Stop recording";

  return (
    <div className="pill-outer">
      <div
        className={`pill-inner${expanded ? "" : " pill-inner-compact"}${
          hovered ? " pill-hovered" : ""
        }`}
        onMouseDown={handlePillMouseDown}
        onMouseUp={handlePillMouseUp}
      >
        <div
          className={`pill-header${
            detached
              ? " pill-header-detached"
              : !expanded
                ? " pill-vertical"
                : ""
          }`}
          onClick={!expanded && !detached ? handlePillMediaClick : undefined}
        >
          <div className="pill-media">
            <PillLogo className="pill-logo" />
            <LiveAudioBars
              compact={!expanded && !detached}
              className="pill-wave-meter"
            />
          </div>
          <div className="pill-controls">
            <span className="pill-timer">
              {mm}:{ss}
            </span>
            {expanded && !finished ? (
              <button
                type="button"
                onClick={onPauseClick}
                data-no-drag
                className="pill-pause-btn"
                aria-label={paused ? "Resume" : "Pause"}
                title={paused ? "Resume" : "Pause"}
              >
                {paused ? (
                  <IconPlayerPlayFilled size={14} />
                ) : (
                  <IconPlayerPauseFilled size={14} />
                )}
              </button>
            ) : null}
            {!finished ? (
              <button
                type="button"
                onClick={onStopClick}
                disabled={stopping}
                data-no-drag
                className="pill-stop-btn"
                aria-label={stopping ? "Stopping" : stopLabel}
                title={stopping ? "Stopping..." : stopLabel}
              >
                {stopping ? (
                  <IconLoader2 className="pill-spinner" size={14} />
                ) : (
                  <IconPlayerStopFilled size={14} />
                )}
              </button>
            ) : null}
            {finished ? (
              <button
                type="button"
                onClick={() => closeFinished(false)}
                data-no-drag
                className="pill-close-btn"
                aria-label="Dismiss"
                title="Dismiss"
              >
                <IconX size={16} />
              </button>
            ) : (
              <button
                type="button"
                onClick={toggleExpanded}
                data-no-drag
                className="pill-expand-btn"
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                {expanded ? (
                  <IconChevronUp size={16} />
                ) : (
                  <IconChevronDown size={16} />
                )}
              </button>
            )}
          </div>
        </div>

        {error ? (
          <div className="pill-error" role="alert">
            {error}
          </div>
        ) : null}

        <div
          style={
            expanded
              ? {
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  minHeight: 0,
                }
              : { display: "none" }
          }
        >
          <div className="pill-divider" />
          {finished ? (
            <div className="pill-finished-banner" role="status">
              <span className="pill-finished-text">
                Meeting finished — notes are ready
              </span>
              <button
                type="button"
                data-no-drag
                className="pill-finished-open"
                onClick={() => closeFinished(true)}
              >
                Open meeting
              </button>
            </div>
          ) : null}
          <div className="pill-transcript-area">
            <div className="pill-pane-label pill-pane-label-row">
              <span>Transcript</span>
              <button
                type="button"
                data-no-drag
                className="pill-copy-btn"
                onClick={handleCopyTranscript}
                disabled={!hasTranscriptLines}
                aria-label="Copy transcript"
                title="Copy transcript"
              >
                {transcriptCopied ? (
                  <IconCheck size={12} />
                ) : (
                  <IconCopy size={12} />
                )}
              </button>
            </div>
            <LiveTranscript
              onLinesChange={handleTranscriptLines}
              initialLines={preloadedLines}
            />
          </div>
          {ctx.mode === "meeting" ? (
            <form className="pill-ask-bar" onSubmit={handleAskSubmit}>
              <input
                data-no-drag
                className="pill-ask-input"
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                placeholder="Ask anything"
                aria-label="Ask anything about this meeting"
                disabled={!ctx.meetingId}
              />
              <button
                type="submit"
                data-no-drag
                className="pill-ask-send"
                disabled={!ask.trim() || !ctx.meetingId}
                aria-label="Ask"
                title="Ask"
              >
                <IconArrowUp size={13} />
              </button>
              <button
                type="button"
                data-no-drag
                className="pill-ask-open"
                onClick={() => {
                  const mid = activeMeetingIdRef.current;
                  if (mid)
                    emit("clips:open-meeting", { meetingId: mid }).catch(
                      () => {},
                    );
                }}
                aria-label="Open in browser"
                title="Open this meeting in the browser"
              >
                <IconExternalLink size={13} />
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
