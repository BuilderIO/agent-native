import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconLoader2,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";

import { LiveWaveform } from "../components/live-waveform";
import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { applyFrame, settleSteps, type AgentStep } from "../lib/agent-steps";
import {
  ASK_SHEET_DEFAULT,
  ASK_SHEET_DISMISS_AT,
  clampAskSheetHeight,
} from "../lib/ask-sheet-layout";
import {
  type AskTurn,
  buildMeetingAskPrompt,
  MAX_ASK_HISTORY_TURNS,
  streamMeetingAsk,
} from "../lib/meeting-ask";
import { isDirectPillClick, type ScreenPoint } from "../lib/pill-interaction";
import { speakerFor, type TranscriptLine } from "../lib/transcription-engine";
import { loadStoredServerUrl } from "../lib/url";
import { AskSteps } from "./ask-steps";
import { LiveTranscript, type FinalLine } from "./live-transcript";
import { PillLogo } from "./pill-logo";

/** Matches `pill-ask-sheet-out` in styles.css. */
const ASK_SHEET_EXIT_MS = 200;

type PillMode = "meeting" | "clip";

interface PillContext {
  meetingId?: string | null;
  mode?: PillMode;
  title?: string | null;
  /** On screen, but capture has not attached yet. Never claim "recording". */
  starting?: boolean;
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
const pillDemoMode = import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);

export function MeetingPill() {
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(false);
  /** Demo harness only: the meter reads capture events in the real app. */
  const [demoLevel, setDemoLevel] = useState<number | null>(null);
  const demoLevelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
  // Inline ask conversation (the Wispr interaction): a sheet rises from the
  // composer with the running exchange — user questions as chat bubbles,
  // streamed answers, and contextual suggestion chips. In Tauri the answers
  // stream live from the agent chat (see `streamMeetingAsk`); the demo
  // branch streams canned answers so the interaction stays designable in a
  // plain browser tab.
  const [askMessages, setAskMessages] = useState<
    Array<{
      role: "user" | "assistant";
      text: string;
      streaming?: boolean;
      steps?: AgentStep[];
    }>
  >([]);
  // The flex column the transcript and the answer sheet divide between them.
  const pillInnerRef = useRef<HTMLDivElement | null>(null);
  const [askSheetOpen, setAskSheetOpen] = useState(false);
  /** Held open for the exit animation. A drawer that vanishes on close reads
   *  as a bug even when the entrance is right. */
  const [askSheetClosing, setAskSheetClosing] = useState(false);
  const askSheetExitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [askSheetHeight, setAskSheetHeight] = useState(ASK_SHEET_DEFAULT);
  const askStreamRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const askAbortRef = useRef<AbortController | null>(null);
  const chipsAbortRef = useRef<AbortController | null>(null);
  const chipsFetchedAtRef = useRef(0);
  const [askChips, setAskChips] = useState<
    Array<{ label: string; ask: string }>
  >([]);

  /** The last ~2 minutes of transcript, capped, most recent last — inlined
   * into the ask scaffold so simple questions need no tool round trip and
   * chip generation sees what was just said. */
  const recentTranscriptText = () => {
    const lines = transcriptLinesRef.current;
    const latest = lines[lines.length - 1]?.startMs ?? null;
    const windowed =
      latest === null
        ? lines.slice(-20)
        : lines.filter(
            (l) => l.startMs === null || latest - l.startMs <= 120_000,
          );
    let out = windowed
      .map((l) => `${speakerFor(l.source)}: ${l.text}`)
      .join("\n");
    if (out.length > 2_400) out = out.slice(-2_400);
    return out;
  };
  // Follow-up context for the live transport: prior scaffolded questions and
  // final answers, sent as `history` with each ask (no threadId — see
  // `streamMeetingAsk`). Reset with the session.
  const askHistoryRef = useRef<AskTurn[]>([]);
  const askSheetScrollRef = useRef<HTMLDivElement | null>(null);
  const sheetDragRef = useRef<{
    startY: number;
    startHeight: number;
  } | null>(null);
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
          title: ev.payload?.title ?? ctxRef.current.title ?? null,
          // Rust re-emits this event on every `recording_pill_show` without a
          // `starting` field. Absent means "no opinion" — coercing it to false
          // there would race the starting flag to a live-looking pill.
          starting: ev.payload?.starting ?? ctxRef.current.starting ?? false,
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
        // A new session is a new meeting: drop the old ask conversation and
        // abort any in-flight answer so it can't stream into the wrong sheet.
        askAbortRef.current?.abort();
        askAbortRef.current = null;
        chipsAbortRef.current?.abort();
        chipsAbortRef.current = null;
        chipsFetchedAtRef.current = 0;
        setAskChips([]);
        askHistoryRef.current = [];
        setAskMessages([]);
        setAskSheetOpen(false);
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
    // Recovery: the context event is push-only, so a pill window that mounts
    // after it fired (webview reload, popover restart) would strand in clip
    // mode with no ask bar. Rust owns the active meeting id — ask it.
    invoke<string | null>("get_active_meeting_id")
      .then((meetingId) => {
        if (!meetingId || stopped) return;
        if (
          ctxRef.current.mode === "meeting" &&
          ctxRef.current.meetingId === meetingId
        ) {
          return;
        }
        const next: PillContext = { meetingId, mode: "meeting", title: null };
        ctxRef.current = next;
        setCtx(next);
        activeMeetingIdRef.current = meetingId;
      })
      .catch(() => {});
    if (pillDemoMode) {
      // Open in the starting state the real pill now shows, so the spinner is
      // reviewable in the harness rather than only during a live start.
      ctxRef.current = {
        mode: "meeting",
        meetingId: "demo",
        title: "Promotion readiness review",
        starting: true,
      };
      setCtx(ctxRef.current);
      setTimeout(() => {
        ctxRef.current = { ...ctxRef.current, starting: false };
        setCtx(ctxRef.current);
      }, 4_000);
      activeMeetingIdRef.current = "demo";
      setExpanded(true);
      setPreloadedLines([
        {
          source: "system",
          text: "So XIE went through a bunch of different questions and we've settled on three. Yesterday we just swapped one completely out because it used to be a design system question.",
          startMs: 406_000,
        },
        {
          source: "system",
          text: "but the design system indexing can take up to an hour. And so.",
          startMs: 417_000,
        },
        {
          source: "mic",
          text: "Alright, that makes sense. Do we have a fallback if the indexing is still running when the review starts?",
          startMs: 431_000,
        },
        {
          source: "system",
          text: "We can pin the previous index and swap when the fresh one lands.",
          startMs: 449_000,
        },
      ] as FinalLine[]);
      demoLevelTimerRef.current = setInterval(() => {
        setDemoLevel(0.04 + Math.random() * 0.28);
      }, 90);
    }
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
      askAbortRef.current?.abort();
      askAbortRef.current = null;
      if (askSheetExitRef.current) {
        clearTimeout(askSheetExitRef.current);
        askSheetExitRef.current = null;
      }
      if (demoLevelTimerRef.current) {
        clearInterval(demoLevelTimerRef.current);
        demoLevelTimerRef.current = null;
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

  /** Canned step rows so the demo harness shows the real streaming shape. */
  const demoAskSteps = (progress: number, done: boolean): AgentStep[] => {
    const steps: AgentStep[] = [
      {
        key: "demo-think",
        label: "Thought",
        kind: "think",
        status: "done",
        detail:
          "The ask is about what was decided, so the meeting itself comes first, then anything similar from past meetings.",
      },
      {
        key: "demo-read",
        label: "Reading this meeting",
        kind: "read",
        status: progress >= 6 ? "done" : "running",
        detail: progress >= 6 ? "1 result" : undefined,
      },
    ];
    if (progress >= 6) {
      steps.push({
        key: "demo-search",
        label: "Searching past meetings",
        kind: "search",
        status: progress >= 14 ? "done" : "running",
        detail: progress >= 14 ? "3 results" : undefined,
      });
    }
    return done ? settleSteps(steps) : steps;
  };

  const openAskSheet = () => {
    if (askSheetExitRef.current) {
      clearTimeout(askSheetExitRef.current);
      askSheetExitRef.current = null;
    }
    setAskSheetClosing(false);
    setAskSheetOpen(true);
  };

  const submitAsk = (question: string) => {
    const mid = activeMeetingIdRef.current;
    if (!question || !mid) return;
    refreshAskChips();
    if (pillDemoMode) {
      if (askStreamRef.current) clearInterval(askStreamRef.current);
      const canned = question.toLowerCase().includes("miss")
        ? "Your key points since you tuned out:\n1. The question set is final: three questions, with the design system one swapped out yesterday.\n2. Indexing risk: it can take up to an hour, raised as the main open concern.\n3. Fallback agreed: pin the previous index and swap when the fresh one lands."
        : "You landed on three questions after swapping out the design system one. The open risk is indexing time (up to an hour); the fallback is pinning the previous index and swapping when the fresh one lands.";
      const words = canned.split(" ");
      let i = 0;
      openAskSheet();
      setAskMessages((m) => [
        ...m,
        { role: "user", text: question },
        { role: "assistant", text: "", streaming: true },
      ]);
      askStreamRef.current = setInterval(() => {
        i += 2;
        const done = i >= words.length;
        setAskMessages((m) => {
          const next = [...m];
          next[next.length - 1] = {
            role: "assistant",
            text: words.slice(0, i).join(" "),
            streaming: !done,
            steps: demoAskSteps(i, done),
          };
          return next;
        });
        const scroller = askSheetScrollRef.current;
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        if (done && askStreamRef.current) {
          clearInterval(askStreamRef.current);
          askStreamRef.current = null;
        }
      }, 55);
      return;
    }
    // Live transport: stream the answer from the agent chat into the same
    // askMessages the demo branch fills, instead of ejecting to the web app.
    askAbortRef.current?.abort();
    const controller = new AbortController();
    askAbortRef.current = controller;
    openAskSheet();
    setAskMessages((m) => [
      // A superseded in-flight answer keeps its partial text; drop its caret.
      ...m.map((msg) => (msg.streaming ? { ...msg, streaming: false } : msg)),
      { role: "user", text: question },
      { role: "assistant", text: "", streaming: true },
    ]);
    const appendToAnswer = (delta: string) => {
      // A late chunk racing the abort must not touch the next ask's bubble.
      if (controller.signal.aborted) return;
      setAskMessages((m) => {
        const last = m[m.length - 1];
        if (!last || last.role !== "assistant") return m;
        return [...m.slice(0, -1), { ...last, text: last.text + delta }];
      });
      const scroller = askSheetScrollRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    };
    // Tool calls, their outcomes, and progress labels land on the answer
    // bubble as they stream, so the wait reads as work rather than a hang.
    const updateSteps = (next: (steps: AgentStep[]) => AgentStep[]) => {
      if (controller.signal.aborted) return;
      setAskMessages((m) => {
        const last = m[m.length - 1];
        if (!last || last.role !== "assistant") return m;
        const steps = next(last.steps ?? []);
        if (steps === last.steps) return m;
        return [...m.slice(0, -1), { ...last, steps }];
      });
    };
    const title = ctxRef.current.title ?? null;
    const recentTranscript = recentTranscriptText();
    void (async () => {
      try {
        const answer = await streamMeetingAsk({
          serverUrl: loadStoredServerUrl(),
          meetingId: mid,
          meetingTitle: title,
          question,
          history: askHistoryRef.current,
          signal: controller.signal,
          recentTranscript,
          onFrame: (frame) => updateSteps((steps) => applyFrame(steps, frame)),
          onTextDelta: appendToAnswer,
        });
        if (controller.signal.aborted) return;
        const exchange: AskTurn[] = [
          {
            role: "user",
            content: buildMeetingAskPrompt(
              mid,
              title,
              question,
              recentTranscript,
            ),
          },
          { role: "assistant", content: answer },
        ];
        askHistoryRef.current = [...askHistoryRef.current, ...exchange].slice(
          -MAX_ASK_HISTORY_TURNS,
        );
        setAskMessages((m) => {
          const last = m[m.length - 1];
          if (!last || last.role !== "assistant") return m;
          return [
            ...m.slice(0, -1),
            {
              ...last,
              streaming: false,
              steps: last.steps ? settleSteps(last.steps) : last.steps,
            },
          ];
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        const line =
          err instanceof Error && err.message.trim()
            ? err.message.trim()
            : "Couldn't reach the agent. Try again.";
        setAskMessages((m) => {
          const last = m[m.length - 1];
          if (!last || last.role !== "assistant") return m;
          return [
            ...m.slice(0, -1),
            {
              ...last,
              text: last.text ? `${last.text}\n${line}` : line,
              streaming: false,
              steps: last.steps ? settleSteps(last.steps) : last.steps,
            },
          ];
        });
      }
    })();
  };

  const handleAskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const question = ask.trim();
    if (!question) return;
    setAsk("");
    submitAsk(question);
  };

  /** Chips are proposed by the agent from the recent transcript (tools off,
   * JSON only), so they track what was actually just said — a spoken "we
   * should meet Wednesday at 7" should surface a booking chip. Static
   * fallbacks cover failures and the first seconds of a meeting. */
  const refreshAskChips = () => {
    if (pillDemoMode) return;
    const mid = activeMeetingIdRef.current;
    if (!mid) return;
    const now = Date.now();
    if (now - chipsFetchedAtRef.current < 60_000) return;
    chipsFetchedAtRef.current = now;
    const transcript = recentTranscriptText();
    if (!transcript.trim()) return;
    chipsAbortRef.current?.abort();
    const controller = new AbortController();
    chipsAbortRef.current = controller;
    void streamMeetingAsk({
      serverUrl: loadStoredServerUrl(),
      meetingId: mid,
      meetingTitle: ctxRef.current.title ?? null,
      question: "chips",
      history: [],
      signal: controller.signal,
      onTextDelta: () => {},
      promptOverride: [
        "Do not use any tools. Reply with ONLY a JSON array, no prose and no code fences.",
        "Based on this live-meeting transcript excerpt, propose up to 3 quick assistant actions or questions the user is most likely to want right now. Prefer concrete actions grounded in what was said (booking something mentioned, drafting a follow-up, checking whether a topic was discussed in past meetings).",
        'Each array item: {"label": "chip text, 24 chars max", "ask": "the full request to run"}.',
        "",
        "Transcript (most recent last):",
        transcript,
      ].join("\n"),
    })
      .then((raw) => {
        if (controller.signal.aborted) return;
        const match = raw.match(/\[[\s\S]*\]/);
        if (!match) return;
        const parsed = JSON.parse(match[0]) as Array<{
          label?: unknown;
          ask?: unknown;
        }>;
        const chips = parsed
          .filter(
            (c) => typeof c.label === "string" && typeof c.ask === "string",
          )
          .slice(0, 3)
          .map((c) => ({
            label: (c.label as string).slice(0, 28),
            ask: c.ask as string,
          }));
        if (chips.length) setAskChips(chips);
      })
      .catch(() => {
        // Chip generation is a garnish: failures keep the static fallbacks.
      });
  };

  const closeAskSheet = () => {
    if (askStreamRef.current) {
      clearInterval(askStreamRef.current);
      askStreamRef.current = null;
    }
    // Dismissing the sheet abandons the in-flight answer; keep the partial
    // text (minus its caret) for when the sheet reopens.
    askAbortRef.current?.abort();
    askAbortRef.current = null;
    setAskMessages((m) =>
      m.map((msg) => (msg.streaming ? { ...msg, streaming: false } : msg)),
    );
    setAskSheetClosing(true);
    if (askSheetExitRef.current) clearTimeout(askSheetExitRef.current);
    askSheetExitRef.current = setTimeout(() => {
      askSheetExitRef.current = null;
      setAskSheetClosing(false);
      setAskSheetOpen(false);
    }, ASK_SHEET_EXIT_MS);
  };

  // A split that leaves the transcript room on a tall window can starve it on a
  // short one, so the ratio is re-clamped against the panel's real height
  // whenever that height changes.
  useEffect(() => {
    const host = pillInnerRef.current;
    if (!host || !askSheetOpen || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const total = host.clientHeight;
      if (total <= 0) return;
      setAskSheetHeight((current) => clampAskSheetHeight(current, total));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [askSheetOpen]);

  // The sheet's grab handle: drag to resize, pull down far enough to dismiss.
  const handleSheetHandlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    sheetDragRef.current = { startY: e.clientY, startHeight: askSheetHeight };
  };
  const handleSheetHandlePointerMove = (e: React.PointerEvent) => {
    const drag = sheetDragRef.current;
    if (!drag) return;
    const total = pillInnerRef.current?.clientHeight ?? 340;
    const next = drag.startHeight + (drag.startY - e.clientY) / total;
    setAskSheetHeight(clampAskSheetHeight(next, total));
  };
  const handleSheetHandlePointerUp = () => {
    if (!sheetDragRef.current) return;
    sheetDragRef.current = null;
    if (askSheetHeight <= ASK_SHEET_DISMISS_AT) {
      setAskSheetHeight(ASK_SHEET_DEFAULT);
      closeAskSheet();
    }
  };

  // Persist the user's expanded-panel size while they drag the native edge
  // grips (the window is resizable only while expanded).
  useEffect(() => {
    if (pillDemoMode || !expanded) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | null = null;
    void getCurrentWindow()
      .onResized(({ payload }) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void invoke("recording_pill_save_expanded_size", {
            w: payload.width,
            h: payload.height,
          }).catch(() => {});
        }, 500);
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => {
      if (timer) clearTimeout(timer);
      unlisten?.();
    };
  }, [expanded]);

  // Escape closes the ask sheet before anything else.
  useEffect(() => {
    if (!askSheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAskSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askSheetOpen]);

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

  const mm = String(Math.floor(elapsed / 60));
  const ss = String(elapsed % 60).padStart(2, "0");
  const stopLabel =
    ctx.mode === "meeting" ? "Stop transcription" : "Stop recording";

  return (
    <div
      className="pill-outer"
      style={
        pillDemoMode
          ? { width: 480, height: 340, margin: 40, position: "relative" }
          : undefined
      }
    >
      <div
        ref={pillInnerRef}
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
            {expanded && !detached ? null : <PillLogo className="pill-logo" />}
            {expanded && !detached && ctx.mode === "meeting" ? (
              <span className="pill-title" title={ctx.title ?? undefined}>
                {ctx.title || "Meeting notes"}
              </span>
            ) : null}
            {ctx.starting ? (
              <Spinner className="pill-media-spinner size-3.5" />
            ) : (
              <LiveWaveform
                className="pill-wave-meter"
                bars={expanded && !detached ? 5 : 4}
                dimmed={paused || finished}
                level={pillDemoMode ? demoLevel : null}
              />
            )}
          </div>
          <div className="pill-controls">
            {ctx.starting ? (
              <span className="pill-timer pill-timer-starting">
                <Spinner className="size-3" />
                Starting
              </span>
            ) : expanded && !detached && ctx.mode === "meeting" ? null : (
              <span
                className={`pill-timer${!paused && !finished ? " pill-timer-live" : ""}`}
              >
                {mm}:{ss}
              </span>
            )}
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
            {!finished && !(expanded && !detached && ctx.mode === "meeting") ? (
              <button
                type="button"
                onClick={onStopClick}
                disabled={stopping || ctx.starting === true}
                data-no-drag
                className="pill-stop-btn"
                aria-label={stopping ? "Stopping" : stopLabel}
                title={stopping ? "Stopping..." : stopLabel}
              >
                {stopping ? (
                  <IconLoader2 className="pill-spinner" size={14} />
                ) : (
                  <span aria-hidden className="pill-stop-square" />
                )}
              </button>
            ) : null}
            {expanded && !finished ? (
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
                  <IconCheck size={14} />
                ) : (
                  <IconCopy size={14} />
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
            <LiveTranscript
              onLinesChange={handleTranscriptLines}
              initialLines={preloadedLines}
            />
          </div>
          {askSheetOpen ? (
            <div
              className="pill-ask-sheet"
              data-state={askSheetClosing ? "closing" : "open"}
              style={{ height: `${Math.round(askSheetHeight * 100)}%` }}
              data-no-drag
            >
              <div
                className="pill-ask-sheet-grip"
                role="button"
                tabIndex={0}
                aria-label="Resize or dismiss answers"
                data-no-drag
                onPointerDown={handleSheetHandlePointerDown}
                onPointerMove={handleSheetHandlePointerMove}
                onPointerUp={handleSheetHandlePointerUp}
                onClick={(e) => {
                  if (e.detail > 0 && !sheetDragRef.current) closeAskSheet();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") closeAskSheet();
                }}
              >
                <span className="pill-ask-sheet-handle" aria-hidden />
              </div>
              <div className="pill-ask-sheet-scroll" ref={askSheetScrollRef}>
                {askMessages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="pill-ask-msg-user">
                      {m.text}
                    </div>
                  ) : (
                    <div key={i} className="pill-ask-msg-assistant">
                      <AskSteps steps={m.steps} streaming={m.streaming} />
                      {m.text}
                      {m.streaming ? (
                        <span className="pill-ask-thread-caret" aria-hidden />
                      ) : null}
                    </div>
                  ),
                )}
              </div>
              <div className="pill-ask-suggestions" data-no-drag>
                {(askChips.length
                  ? askChips
                  : [
                      { label: "What did I miss?", ask: "What did I miss?" },
                      {
                        label: "Summarize decisions",
                        ask: "Summarize the decisions made so far",
                      },
                      {
                        label: "Suggest questions",
                        ask: "Suggest questions I should ask next",
                      },
                    ]
                ).map((chip) => (
                  <Button
                    key={chip.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    data-no-drag
                    className="h-7 shrink-0 rounded-full px-3 text-xs font-normal"
                    onClick={() => submitAsk(chip.ask)}
                  >
                    {chip.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {ctx.mode === "meeting" ? (
            <form className="pill-ask-bar" onSubmit={handleAskSubmit}>
              {!finished ? (
                <Button
                  type="button"
                  onClick={onStopClick}
                  disabled={stopping}
                  data-no-drag
                  variant="secondary"
                  // `border-0`: this app opts out of Tailwind preflight (see
                  // tailwind.css), so a shadcn variant with no border utility
                  // inherits the UA's 2px button border.
                  className="h-[34px] shrink-0 gap-[7px] rounded-full border-0 px-[13px] text-[13px] font-semibold"
                  aria-label={stopping ? "Stopping" : stopLabel}
                  title={stopping ? "Stopping..." : stopLabel}
                >
                  {stopping ? (
                    <Spinner className="size-[13px]" />
                  ) : (
                    <span aria-hidden className="pill-stop-inline-square" />
                  )}
                  Stop
                </Button>
              ) : null}
              <div className="pill-ask-field" data-no-drag>
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
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
