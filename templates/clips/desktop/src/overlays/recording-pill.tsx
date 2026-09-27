import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconLoader2,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconShare,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useRef, useState } from "react";

import { LiveWaveform } from "../components/live-waveform";
import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { applyFrame, settleSteps, type AgentStep } from "../lib/agent-steps";
import {
  ASK_SHEET_DEFAULT,
  ASK_SHEET_DISMISS_AT,
  clampAskSheetHeight,
  isPinnedToBottom,
  isSheetGripTap,
} from "../lib/ask-sheet-layout";
import {
  type AskTurn,
  buildMeetingAskPrompt,
  fenceTranscript,
  MAX_ASK_HISTORY_TURNS,
  streamMeetingAsk,
} from "../lib/meeting-ask";
import { isDirectPillClick, type ScreenPoint } from "../lib/pill-interaction";
import { writeClipboardText } from "../lib/recording-link";
import { speakerFor, type TranscriptLine } from "../lib/transcription-engine";
import { loadStoredServerUrl } from "../lib/url";
import { AskSteps } from "./ask-steps";
import { LiveTranscript, type FinalLine } from "./live-transcript";
import { PillLogo } from "./pill-logo";

const CAP_HEIGHT_RATIO = 0.72;

const HOVER_INTENT_MS = 150;

const TRANSPORT_GAP_PX = 8;

const TRANSITION_STALL_MS = 400;

const ASK_SHEET_EXIT_MS = 200;

type PillMode = "meeting" | "clip";

interface PillContext {
  meetingId?: string | null;
  mode?: PillMode;
  title?: string | null;
  starting?: boolean;
}

const pillDemoMode = import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);

export function MeetingPill() {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(false);
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
  const [providerStatus, setProviderStatus] = useState<
    "unknown" | "configured" | "missing" | "unavailable"
  >(pillDemoMode ? "configured" : "unknown");
  const providerStatusAbortRef = useRef<AbortController | null>(null);
  const [askMessages, setAskMessages] = useState<
    Array<{
      role: "user" | "assistant";
      text: string;
      streaming?: boolean;
      steps?: AgentStep[];
    }>
  >([]);
  const pillInnerRef = useRef<HTMLDivElement | null>(null);
  const [askSheetOpen, setAskSheetOpen] = useState(false);
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

  const checkProviderStatus = useCallback(async () => {
    if (pillDemoMode) {
      setProviderStatus("configured");
      return;
    }
    providerStatusAbortRef.current?.abort();
    const controller = new AbortController();
    providerStatusAbortRef.current = controller;
    setProviderStatus("unknown");
    try {
      const response = await fetch(
        `${loadStoredServerUrl()}/_agent-native/agent-engine/status`,
        { credentials: "include", signal: controller.signal },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { configured?: unknown };
      if (typeof body.configured !== "boolean") {
        throw new Error("Provider status response was incomplete");
      }
      if (!controller.signal.aborted) {
        setProviderStatus(body.configured ? "configured" : "missing");
      }
    } catch {
      if (!controller.signal.aborted) setProviderStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    if (ctx.mode !== "meeting" || !ctx.meetingId) {
      setProviderStatus("configured");
      return;
    }
    void checkProviderStatus();
    return () => providerStatusAbortRef.current?.abort();
  }, [checkProviderStatus, ctx.meetingId, ctx.mode]);

  useEffect(() => {
    if (
      pillDemoMode ||
      ctx.mode !== "meeting" ||
      !ctx.meetingId ||
      (providerStatus !== "missing" && providerStatus !== "unavailable")
    ) {
      return;
    }
    const onFocus = () => void checkProviderStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [checkProviderStatus, ctx.meetingId, ctx.mode, providerStatus]);

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
  const askHistoryRef = useRef<AskTurn[]>([]);
  const askSheetScrollRef = useRef<HTMLDivElement | null>(null);
  const askPinnedRef = useRef(true);
  const scrollAskSheetIfPinned = useCallback(() => {
    const el = askSheetScrollRef.current;
    if (el && askPinnedRef.current) el.scrollTop = el.scrollHeight;
  }, []);
  const sheetDragRef = useRef<{
    startY: number;
    startHeight: number;
  } | null>(null);
  const sheetDragMovedRef = useRef(false);
  const activeMeetingIdRef = useRef<string | null>(null);
  const [detached, setDetached] = useState(false);
  const [hovered, setHovered] = useState(false);
  const startedAtRef = useRef<number>(Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
        const prev = ctxRef.current;
        const meetingId = ev.payload?.meetingId ?? null;
        const mode = ev.payload?.mode ?? "clip";
        const isSameSession =
          prev.meetingId === meetingId && prev.mode === mode;
        const next: PillContext = {
          meetingId,
          mode,
          title:
            ev.payload?.title ?? (isSameSession ? prev.title : null) ?? null,
          starting:
            ev.payload?.starting ??
            (isSameSession ? prev.starting : false) ??
            false,
        };
        ctxRef.current = next;
        setCtx(next);
        if (isSameSession) return;
        startedAtRef.current = Date.now();
        setElapsed(0);
        setPaused(false);
        setStopping(false);
        setFinishedMeetingId(null);
        setError(null);
        setExpanded(false);
        setPreloadedLines([]);
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
      listen("voice:audio-level", () => {
        clearStartingRef.current();
      }),
    );
    trackListen(
      listen<{ paused: boolean; elapsedMs: number }>(
        "clips:recorder-state",
        (ev) => {
          clearStartingRef.current();
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
        if (ev.payload?.detached) setExpanded(false);
      }),
    );
    emit("clips:pill-ready", {}).catch(() => {});
    invoke<string | null>("get_active_meeting_id")
      .then((meetingId) => {
        if (!meetingId || stopped) return;
        if (ctxRef.current.meetingId !== null) return;
        const next: PillContext = { meetingId, mode: "meeting", title: null };
        ctxRef.current = next;
        setCtx(next);
        activeMeetingIdRef.current = meetingId;
      })
      .catch(() => {});
    if (pillDemoMode) {
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

  useEffect(() => {
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
    if (ctxRef.current.mode === "meeting" && meetingId) {
      showFinished(meetingId);
      return;
    }
    setStopping(true);
    stopFallbackRef.current = setTimeout(() => {
      invoke("recording_pill_hide").catch(() => {});
    }, 3_000);
  }

  const capsuleRef = useRef<HTMLDivElement | null>(null);
  const transportRef = useRef<HTMLDivElement | null>(null);
  const windowOpChainRef = useRef<Promise<void>>(Promise.resolve());
  const clearStartingRef = useRef<() => void>(() => {});

  const clearStarting = useCallback(() => {
    if (!ctxRef.current.starting) return;
    ctxRef.current = { ...ctxRef.current, starting: false };
    setCtx(ctxRef.current);
  }, []);

  clearStartingRef.current = clearStarting;

  const queueWindowOp = (op: () => Promise<void>) => {
    windowOpChainRef.current = windowOpChainRef.current
      .then(op)
      .catch((err) => {
        console.warn("[clips-pill] window op failed", err);
      });
  };

  const syncCapsuleWindow = useCallback((extraLogicalHeight: number) => {
    const el = capsuleRef.current;
    if (!el || pillDemoMode) return;
    const contentH = el.offsetHeight + extraLogicalHeight;
    const contentW = el.offsetWidth;
    queueWindowOp(async () => {
      const win = getCurrentWindow();
      const [size, scale] = await Promise.all([
        win.outerSize(),
        win.scaleFactor(),
      ]);
      const w = Math.ceil(contentW * scale);
      const h = Math.ceil(contentH * scale);
      if (size.width === w && size.height === h) return;
      await win.setSize(new PhysicalSize(w, h));
    });
  }, []);

  useEffect(() => {
    if (expanded || detached || ctx.mode !== "meeting" || finished) return;
    const seg = transportRef.current;
    if (!seg) return;
    const open = hovered && !ctx.starting;

    let release: (() => void) | null = null;

    const contentHeight = () => {
      const kids = Array.from(seg.children).filter(
        (kid): kid is HTMLElement =>
          kid instanceof HTMLElement &&
          window.getComputedStyle(kid).display !== "none",
      );
      const gap = parseFloat(window.getComputedStyle(seg).rowGap) || 0;
      const stacked = kids.reduce((total, kid) => total + kid.offsetHeight, 0);
      return stacked + gap * Math.max(0, kids.length - 1);
    };

    const apply = () => {
      const target = open ? contentHeight() : 0;
      if (open) seg.dataset.open = "true";
      else delete seg.dataset.open;
      seg.style.transition = "";
      seg.style.height = `${target}px`;
      seg.style.marginTop = open ? `${TRANSPORT_GAP_PX}px` : "0px";
      seg.style.opacity = open ? "1" : "0";
      if (open) syncCapsuleWindow(target + TRANSPORT_GAP_PX);

      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        if (!open) syncCapsuleWindow(0);
      };
      const forceSnap = () => {
        if (settled) return;
        seg.style.transition = "none";
        seg.style.height = `${target}px`;
        seg.style.marginTop = open ? `${TRANSPORT_GAP_PX}px` : "0px";
        seg.style.opacity = open ? "1" : "0";
        void seg.offsetHeight;
        seg.style.transition = "";
        settle();
      };
      seg.addEventListener("transitionend", settle, { once: true });
      const stalled = setTimeout(forceSnap, TRANSITION_STALL_MS);
      release = () => {
        seg.removeEventListener("transitionend", settle);
        clearTimeout(stalled);
      };
    };

    let intent: ReturnType<typeof setTimeout> | null = null;
    if (open && !seg.dataset.open) intent = setTimeout(apply, HOVER_INTENT_MS);
    else apply();

    return () => {
      if (intent) clearTimeout(intent);
      release?.();
    };
  }, [
    hovered,
    expanded,
    detached,
    ctx.mode,
    ctx.starting,
    finished,
    syncCapsuleWindow,
  ]);

  useEffect(() => {
    if (!expanded || pillDemoMode) return;
    let frame = 0;
    const align = () => {
      const header = pillInnerRef.current?.querySelector(".pill-header");
      const title = header?.querySelector(".pill-title");
      const controls = header?.querySelector<HTMLElement>(".pill-controls");
      if (!header || !title || !controls) return;
      const marker = document.createElement("span");
      marker.style.cssText = "display:inline-block;width:0;height:0;";
      title.appendChild(marker);
      const baseline = marker.getBoundingClientRect().top;
      title.removeChild(marker);
      if (!baseline) return;
      const fontSize = parseFloat(window.getComputedStyle(title).fontSize);
      const capCentre = baseline - (fontSize * CAP_HEIGHT_RATIO) / 2;
      const rect = controls.getBoundingClientRect();
      const shift = capCentre - (rect.top + rect.bottom) / 2;
      const style = (header as HTMLElement).style;
      style.setProperty("--header-ink-shift", `${shift.toFixed(2)}px`);

      const bars = Array.from(
        header.querySelectorAll<HTMLElement>(".pill-wave-meter i"),
      );
      if (bars.length) {
        const rects = bars.map((bar) => bar.getBoundingClientRect());
        const band =
          (Math.min(...rects.map((r) => r.top)) +
            Math.max(...rects.map((r) => r.bottom))) /
          2;
        style.setProperty(
          "--header-meter-shift",
          `${(capCentre - band).toFixed(2)}px`,
        );
      }
    };
    align();
    frame = requestAnimationFrame(align);
    const timer = setTimeout(align, 400);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [expanded, ctx.title, ctx.starting, finished]);

  const handleTranscriptLines = useCallback(
    (lines: TranscriptLine[]) => {
      transcriptLinesRef.current = lines;
      setHasTranscriptLines(lines.length > 0);
      if (lines.length) clearStarting();
    },
    [clearStarting],
  );

  const handleCopyTranscript = async () => {
    const lines = transcriptLinesRef.current;
    if (!lines.length) return;
    const text = lines
      .map((l) => `${speakerFor(l.source)}: ${l.text}`)
      .join("\n");
    try {
      if (!(await writeClipboardText(text))) return;
      setTranscriptCopied(true);
      setTimeout(() => setTranscriptCopied(false), 1500);
    } catch {
      // ignore — clipboard may be unavailable in this window
    }
  };

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
    if (
      !question ||
      !mid ||
      (!pillDemoMode && providerStatus !== "configured")
    ) {
      return;
    }
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
        if (done && askStreamRef.current) {
          clearInterval(askStreamRef.current);
          askStreamRef.current = null;
        }
      }, 55);
      return;
    }
    askAbortRef.current?.abort();
    const controller = new AbortController();
    askAbortRef.current = controller;
    openAskSheet();
    askPinnedRef.current = true;
    setAskMessages((m) => [
      ...m.map((msg) => (msg.streaming ? { ...msg, streaming: false } : msg)),
      { role: "user", text: question },
      { role: "assistant", text: "", streaming: true },
    ]);
    const appendToAnswer = (delta: string) => {
      if (controller.signal.aborted) return;
      setAskMessages((m) => {
        const last = m[m.length - 1];
        if (!last || last.role !== "assistant") return m;
        return [...m.slice(0, -1), { ...last, text: last.text + delta }];
      });
    };
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
        const { answer, incomplete } = await streamMeetingAsk({
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
          {
            role: "assistant",
            content: incomplete
              ? `${answer}\n\n(${incomplete.message})`
              : answer,
          },
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
              text: incomplete
                ? last.text
                  ? `${last.text}\n\n${incomplete.message}`
                  : incomplete.message
                : last.text,
              streaming: false,
              steps: last.steps
                ? settleSteps(last.steps, incomplete)
                : last.steps,
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
              steps: last.steps
                ? settleSteps(last.steps, { kind: "error", message: line })
                : last.steps,
            },
          ];
        });
      }
    })();
  };

  const handleAskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const question = ask.trim();
    if (!question || (!pillDemoMode && providerStatus !== "configured")) {
      return;
    }
    setAsk("");
    submitAsk(question);
  };

  const refreshAskChips = () => {
    if (pillDemoMode || providerStatus !== "configured") return;
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
      mode: "plan",
      promptOverride: [
        "Do not use any tools. Reply with ONLY a JSON array, no prose and no code fences.",
        "You are in read-only mode. That is expected and correct for this request: it only writes suggestion labels, so there is nothing to plan or approve. Do not describe a plan, do not list tools or risks, and do not ask a clarifying question — if the transcript is too thin to suggest anything, reply with an empty array [].",
        "Based on the live-meeting transcript below, propose up to 3 quick assistant actions or questions the user is most likely to want right now. Prefer concrete actions grounded in what was said (booking something mentioned, drafting a follow-up, checking whether a topic was discussed in past meetings).",
        'Each array item: {"label": "chip text, 24 chars max", "ask": "the full request to run"}.',
        "",
        ...fenceTranscript(transcript),
      ].join("\n"),
    })
      .then(({ answer, incomplete }) => {
        if (controller.signal.aborted) return;
        if (incomplete) return;
        const match = answer.match(/\[[\s\S]*\]/);
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

  useEffect(() => {
    scrollAskSheetIfPinned();
  }, [askMessages, askSheetOpen, scrollAskSheetIfPinned]);

  useEffect(() => {
    const el = askSheetScrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => scrollAskSheetIfPinned());
    observer.observe(el);
    return () => observer.disconnect();
  }, [askSheetOpen, scrollAskSheetIfPinned]);

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

  const handleSheetHandlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    sheetDragRef.current = { startY: e.clientY, startHeight: askSheetHeight };
    sheetDragMovedRef.current = false;
  };
  const handleSheetHandlePointerMove = (e: React.PointerEvent) => {
    const drag = sheetDragRef.current;
    if (!drag) return;
    if (!isSheetGripTap(e.clientY - drag.startY)) {
      sheetDragMovedRef.current = true;
    }
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
  const handleSheetHandlePointerCancel = () => {
    sheetDragRef.current = null;
  };

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
        ref={(node) => {
          pillInnerRef.current = node;
          capsuleRef.current = node;
        }}
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
          <div className="pill-controls" ref={transportRef}>
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
            {!finished ? (
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
              <>
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
                <button
                  type="button"
                  onClick={() => closeFinished(true)}
                  data-no-drag
                  className="pill-copy-btn"
                  aria-label="Share meeting"
                  title="Share meeting"
                >
                  <IconShare size={15} />
                </button>
              </>
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
                onPointerCancel={handleSheetHandlePointerCancel}
                onLostPointerCapture={handleSheetHandlePointerCancel}
                onClick={(e) => {
                  if (e.detail > 0 && !sheetDragMovedRef.current) {
                    closeAskSheet();
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") closeAskSheet();
                }}
              >
                <span className="pill-ask-sheet-handle" aria-hidden />
              </div>
              <div
                className="pill-ask-sheet-scroll"
                ref={askSheetScrollRef}
                onScroll={(e) => {
                  askPinnedRef.current = isPinnedToBottom(e.currentTarget);
                }}
              >
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
                    disabled={!pillDemoMode && providerStatus !== "configured"}
                    onClick={() => submitAsk(chip.ask)}
                  >
                    {chip.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {ctx.mode === "meeting" ? (
            <>
              {!pillDemoMode && providerStatus !== "configured" ? (
                <div
                  className="pill-ask-provider-status"
                  data-no-drag
                  role="status"
                >
                  <span>
                    {providerStatus === "unknown"
                      ? t("agentChat.setup.checkingProvider")
                      : providerStatus === "unavailable"
                        ? t("agentChat.setup.providerStatusUnavailable")
                        : t("agentChat.setup.connectToStart")}
                  </span>
                  {providerStatus === "missing" ? (
                    <div className="pill-ask-provider-actions">
                      <button
                        type="button"
                        onClick={() =>
                          void openExternal(
                            new URL(
                              "/settings/agent",
                              loadStoredServerUrl(),
                            ).toString(),
                          )
                        }
                      >
                        {t("agentChat.setup.connectBuilder")}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void openExternal(
                            new URL(
                              "/settings/keys",
                              loadStoredServerUrl(),
                            ).toString(),
                          )
                        }
                      >
                        {t("agentChat.setup.addOwnKeys")}
                      </button>
                    </div>
                  ) : providerStatus === "unavailable" ? (
                    <button
                      type="button"
                      onClick={() => void checkProviderStatus()}
                    >
                      {t("agentChat.common.retry")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <form className="pill-ask-bar" onSubmit={handleAskSubmit}>
                <div className="pill-ask-field" data-no-drag>
                  <input
                    data-no-drag
                    className="pill-ask-input"
                    value={ask}
                    onChange={(e) => setAsk(e.target.value)}
                    placeholder={
                      providerStatus === "configured"
                        ? t("agentNativeClips.meetingAsk.placeholder")
                        : t("agentChat.setup.connectToChat")
                    }
                    aria-label={t("agentNativeClips.meetingAsk.ariaLabel")}
                    disabled={
                      !ctx.meetingId ||
                      (!pillDemoMode && providerStatus !== "configured")
                    }
                  />
                  <button
                    type="submit"
                    data-no-drag
                    className="pill-ask-send"
                    disabled={
                      !ask.trim() ||
                      !ctx.meetingId ||
                      (!pillDemoMode && providerStatus !== "configured")
                    }
                    aria-label={t("agentNativeClips.meetingAsk.ariaLabel")}
                    title={t("agentNativeClips.meetingAsk.ariaLabel")}
                  >
                    <IconArrowUp size={13} />
                  </button>
                </div>
              </form>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
