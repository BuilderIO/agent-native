import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconExternalLink,
  IconGripHorizontal,
  IconLoader2,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";

import { speakerFor } from "../lib/transcription-engine";
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
 *   - Collapsed (default): red dot + elapsed timer + tiny waveform + chevron.
 *   - Expanded: same header + scrolling live transcript + Pause / Stop.
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
  const [error, setError] = useState<string | null>(null);
  const transcriptLinesRef = useRef<FinalLine[]>([]);
  const [hasTranscriptLines, setHasTranscriptLines] = useState(false);
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const [preloadedLines, setPreloadedLines] = useState<FinalLine[]>([]);
  const [notes, setNotes] = useState("");
  const [saveError, setSaveError] = useState(false);
  const notesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest typed notes, mirrored into a ref so the unmount/blur flush can
  // read the current value without re-subscribing.
  const pendingNotesRef = useRef<string | null>(null);
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
  // Per-source levels. The mic recognizer (native_speech.rs) emits with
  // `source: "mic"`; the parallel ScreenCaptureKit tap (system_audio.rs)
  // emits `source: "system"`. We render two stacked bar groups so the user
  // can see each side is being captured.
  const micLevelRef = useRef(0);
  const sysLevelRef = useRef(0);
  // Track whether we've ever seen a system-audio level event in this
  // session — when present, we render the dual-stream waveform; otherwise
  // we collapse back to a single bar group so dictation-only recordings
  // don't get a dead second row.
  const [hasSystemAudio, setHasSystemAudio] = useState(false);
  const micCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sysCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const stopFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        ctxRef.current = next;
        setCtx(next);
        // Reset timer on new context.
        startedAtRef.current = Date.now();
        setElapsed(0);
        // The Rust side reuses the pill window across recordings, so the
        // component never unmounts. Reset stop state explicitly when a
        // new recording session begins, otherwise the Stop button stays
        // disabled and a stale fallback timer can fire mid-session.
        setStopping(false);
        setError(null);
        // Reset notes and transcript state for the new session.
        setNotes("");
        setSaveError(false);
        setPreloadedLines([]);
        pendingNotesRef.current = null;
        // Only clear the meeting id when leaving meeting mode. In meeting mode
        // clips:meeting-notes-init is the authoritative setter — resetting here
        // would race with that event and could wipe a freshly-set id.
        if (ev.payload?.mode !== "meeting") {
          activeMeetingIdRef.current = null;
        }
        if (notesDebounceRef.current) {
          clearTimeout(notesDebounceRef.current);
          notesDebounceRef.current = null;
        }
        if (stopFallbackRef.current) {
          clearTimeout(stopFallbackRef.current);
          stopFallbackRef.current = null;
        }
      }),
    );
    trackListen(
      listen<{ meetingId: string; initialNotes: string }>(
        "clips:meeting-notes-init",
        (ev) => {
          if (ctxRef.current.meetingId !== ev.payload.meetingId) return;
          activeMeetingIdRef.current = ev.payload.meetingId;
          if (pendingNotesRef.current !== null) {
            // User typed before the async fetch resolved — keep their edits and
            // save them now that we have the meeting id. Don't overwrite with
            // server data.
            emit("clips:save-meeting-notes", {
              meetingId: ev.payload.meetingId,
              notes: pendingNotesRef.current,
            }).catch(() => {});
          } else {
            setNotes(ev.payload.initialNotes ?? "");
          }
        },
      ),
    );
    trackListen(
      listen<{ lines: FinalLine[] }>("clips:transcript-preload", (ev) => {
        const lines = ev.payload?.lines;
        if (lines?.length) setPreloadedLines(lines);
      }),
    );
    // Unified auto-save signal from the popover — fires after either the
    // transcript or the notes are persisted.
    trackListen(
      listen<{ meetingId: string; ts: number }>("clips:meeting-saved", (ev) => {
        if (ev.payload?.meetingId !== activeMeetingIdRef.current) return;
        setSaveError(false);
        pendingNotesRef.current = null;
      }),
    );
    trackListen(
      listen("clips:meeting-save-failed", () => {
        setSaveError(true);
      }),
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
    trackListen(
      listen<{ level: number; source?: "mic" | "system" }>(
        "voice:audio-level",
        (ev) => {
          const lvl = Math.max(0, Math.min(1, ev.payload.level));
          const source = ev.payload.source ?? "mic";
          if (source === "system") {
            sysLevelRef.current = lvl;
            setHasSystemAudio(true);
          } else {
            micLevelRef.current = lvl;
          }
        },
      ),
    );
    // Signal that all listeners are registered. app.tsx listens for this and
    // re-emits clips:pill-context + clips:meeting-notes-init so events that
    // fired before React mounted (fresh Tauri window) are not missed.
    emit("clips:pill-ready", {}).catch(() => {});
    return () => {
      stopped = true;
      // Flush any pending note edit before tearing down (e.g. the pill window
      // closing on stop) so the last keystrokes aren't lost.
      flushNotesNow();
      unlistens.forEach((u) => {
        try {
          u();
        } catch {
          // ignore
        }
      });
      if (notesDebounceRef.current) {
        clearTimeout(notesDebounceRef.current);
        notesDebounceRef.current = null;
      }
      if (stopFallbackRef.current) {
        clearTimeout(stopFallbackRef.current);
        stopFallbackRef.current = null;
      }
    };
  }, []);

  // Elapsed timer.
  useEffect(() => {
    if (paused) return;
    tickRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [paused]);

  // Dual-stream waveform — one bar group per source. When system-audio
  // hasn't emitted any levels yet (e.g. dictation-only flow), the system
  // canvas is hidden by the JSX below, but the rAF loop still runs over
  // whichever canvas refs are mounted.
  useEffect(() => {
    const N_PTS = 8;
    const setups: Array<{
      W: number;
      H: number;
      centerY: number;
      ctx2d: CanvasRenderingContext2D;
      rng: number[];
      pts: Array<{ x: number; y: number }>;
      grad: CanvasGradient;
      levelRef: React.MutableRefObject<number>;
      shadowColor: string;
      gain: number;
    }> = [];

    const mount = (
      canvas: HTMLCanvasElement | null,
      levelRef: React.MutableRefObject<number>,
      color: string,
      shadowColor: string,
      gain: number,
    ) => {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return;
      ctx2d.scale(dpr, dpr);
      // Derive zero-alpha edge color from the full color to avoid duplicate strings.
      const color0 = color.replace(/[\d.]+\)$/, "0)");
      const grad = ctx2d.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, color0);
      grad.addColorStop(0.1, color);
      grad.addColorStop(0.9, color);
      grad.addColorStop(1, color0);
      const centerY = H / 2;
      // Pre-allocate pts; mutated in tick to avoid per-frame allocation.
      const pts = Array.from({ length: N_PTS }, (_, i) => ({
        x: (i / (N_PTS - 1)) * W,
        y: centerY,
      }));
      setups.push({
        W,
        H,
        centerY,
        ctx2d,
        rng: Array(N_PTS).fill(0.5),
        pts,
        grad,
        levelRef,
        shadowColor,
        gain,
      });
    };

    // Mic (top, green — matches the collapsed pill's accent). Sys (bottom, sky
    // blue) with 2× gain — system levels run lower.
    mount(
      micCanvasRef.current,
      micLevelRef,
      "rgba(74, 222, 128, 0.95)",
      "rgba(74, 222, 128, 0.55)",
      1.0,
    );
    mount(
      sysCanvasRef.current,
      sysLevelRef,
      "rgba(125, 211, 252, 0.85)",
      "rgba(125, 211, 252, 0.5)",
      2.0,
    );

    // Hoisted outside tick — no closure recreation per frame.
    const drawWavePath = (
      ctx2d: CanvasRenderingContext2D,
      pts: Array<{ x: number; y: number }>,
      W: number,
    ) => {
      ctx2d.moveTo(0, pts[0].y);
      for (let i = 0; i < pts.length - 1; i += 1) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx2d.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx2d.lineTo(W, pts[pts.length - 1].y);
    };

    const startMs = Date.now();
    const tick = () => {
      // Modulo prevents float precision loss on long recordings.
      const t = (Date.now() - startMs) % 1_000_000;
      for (const s of setups) {
        const target = Math.min(1, s.levelRef.current * s.gain);
        for (let i = 0; i < N_PTS; i += 1) {
          const phase = t * 0.004 + i * (Math.PI * 0.65);
          const waveTarget = 0.5 + Math.sin(phase) * target * 0.42;
          s.rng[i] = s.rng[i] * 0.8 + waveTarget * 0.2;
          s.pts[i].y = s.centerY - (s.rng[i] - 0.5) * s.H * 0.88;
        }

        s.ctx2d.clearRect(0, 0, s.W, s.H);

        // Fill between wave and center line.
        s.ctx2d.beginPath();
        drawWavePath(s.ctx2d, s.pts, s.W);
        s.ctx2d.lineTo(s.W, s.centerY);
        s.ctx2d.lineTo(0, s.centerY);
        s.ctx2d.closePath();
        s.ctx2d.globalAlpha = 0.2;
        s.ctx2d.fillStyle = s.grad;
        s.ctx2d.fill();
        s.ctx2d.globalAlpha = 1;

        // Stroke the wave line.
        s.ctx2d.beginPath();
        drawWavePath(s.ctx2d, s.pts, s.W);
        s.ctx2d.lineWidth = 1.5;
        s.ctx2d.strokeStyle = s.grad;
        s.ctx2d.shadowColor = s.shadowColor;
        s.ctx2d.shadowBlur = 5;
        s.ctx2d.stroke();
        s.ctx2d.shadowBlur = 0;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // `expanded` is a dep because the collapsed view renders a single mic
    // canvas while the expanded meeting view can swap to the dual-stream
    // layout — the canvas elements remount and must be re-initialized.
  }, [hasSystemAudio, expanded]);

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
    setPaused(nextPaused);
    emit(nextPaused ? "clips:recorder-pause" : "clips:recorder-resume").catch(
      () => {},
    );
  }

  async function onStopClick() {
    if (stopping) return;
    setStopping(true);
    // Persist any pending note edit before the stop sequence tears the pill
    // window down.
    flushNotesNow();
    emit("clips:pill-stop", { meetingId: ctx.meetingId ?? null }).catch(
      () => {},
    );
    stopFallbackRef.current = setTimeout(() => {
      invoke("recording_pill_hide").catch(() => {});
    }, 3_000);
  }

  // Click on the drag handle (detached mode) un-detaches the pill and
  // re-anchors it bottom-center on the meeting / main app. Re-focuses the
  // main app so the pill mode flips back through the focus listener too.
  async function onHandleClick() {
    try {
      await invoke("recording_pill_set_detached", { detached: false });
    } catch {
      // ignore — best effort
    }
  }

  // Stable callback for LiveTranscript to push locked-in lines up. Stable
  // identity matters — it's a dep of an effect inside LiveTranscript.
  const handleTranscriptLines = useCallback((lines: FinalLine[]) => {
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

  // Immediately persist any pending (debounced) note edit. Used on blur and on
  // unmount so notes typed in the last ~800ms before stopping aren't dropped.
  const flushNotesNow = () => {
    if (!notesDebounceRef.current) return;
    clearTimeout(notesDebounceRef.current);
    notesDebounceRef.current = null;
    const mid = activeMeetingIdRef.current;
    if (mid && pendingNotesRef.current !== null)
      emit("clips:save-meeting-notes", {
        meetingId: mid,
        notes: pendingNotesRef.current,
      }).catch(() => {});
  };

  const handlePillMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    getCurrentWindow()
      .startDragging()
      .catch((err) => {
        console.warn("[clips-pill] startDragging failed", err);
      });
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
      >
        <div
          className={`pill-header${
            detached
              ? " pill-header-detached"
              : !expanded
                ? " pill-vertical"
                : ""
          }`}
        >
          <div
            className="pill-media"
            onClick={
              !expanded && !detached ? () => void toggleExpanded() : undefined
            }
          >
            <PillLogo className="pill-logo" />
            {hasSystemAudio ? (
              <div
                className="pill-wave-dual"
                aria-hidden
                title="Top: you. Bottom: speaker."
              >
                <canvas
                  ref={micCanvasRef}
                  className="pill-wave-canvas-half"
                  aria-label="Microphone level"
                />
                <canvas
                  ref={sysCanvasRef}
                  className="pill-wave-canvas-half"
                  aria-label="System audio level"
                />
              </div>
            ) : (
              <canvas
                ref={micCanvasRef}
                className="pill-wave-canvas"
                aria-hidden
              />
            )}
          </div>
          <div className="pill-controls">
            <span className="pill-timer">
              {mm}:{ss}
            </span>
            {expanded ? (
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
          </div>
          {!expanded && !detached ? (
            <div className="pill-vgrip" aria-hidden>
              <IconGripHorizontal size={14} stroke={2} />
            </div>
          ) : null}
        </div>

        {detached ? (
          <button
            type="button"
            onClick={onHandleClick}
            data-no-drag
            aria-label="Re-attach pill to main window"
            className="pill-drag-handle"
          />
        ) : null}

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
          {ctx.mode === "meeting" ? (
            <div className="pill-split">
              <div className="pill-split-pane">
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
                <div className="pill-transcript-area">
                  <LiveTranscript
                    onLinesChange={handleTranscriptLines}
                    initialLines={preloadedLines}
                  />
                </div>
              </div>
              <div className="pill-split-divider" />
              <div className="pill-split-pane">
                <div className="pill-pane-label">Notes</div>
                <div className="pill-notes-area">
                  <textarea
                    className="pill-notes-textarea"
                    placeholder="Jot down notes during the meeting…"
                    data-no-drag
                    value={notes}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNotes(val);
                      pendingNotesRef.current = val;
                      if (saveError) setSaveError(false);
                      if (notesDebounceRef.current)
                        clearTimeout(notesDebounceRef.current);
                      notesDebounceRef.current = setTimeout(() => {
                        const mid = activeMeetingIdRef.current;
                        if (mid)
                          emit("clips:save-meeting-notes", {
                            meetingId: mid,
                            notes: val,
                          }).catch(() => {});
                      }, 800);
                    }}
                    onBlur={flushNotesNow}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="pill-transcript-area">
              <LiveTranscript
                onLinesChange={handleTranscriptLines}
                initialLines={preloadedLines}
              />
            </div>
          )}
          {ctx.mode === "meeting" ? (
            <div className="pill-saved-bar">
              <button
                type="button"
                data-no-drag
                className="pill-open-web-btn"
                onClick={() => {
                  const mid = activeMeetingIdRef.current;
                  if (mid)
                    emit("clips:open-meeting", { meetingId: mid }).catch(
                      () => {},
                    );
                }}
                title="Open this meeting in the browser"
              >
                <IconExternalLink size={12} />
                Open in browser
              </button>
              <span className="pill-saved-status">
                {saveError ? "Save failed — retrying on next edit" : ""}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
