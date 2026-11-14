/**
 * Dev-only streaming replay harness. It mounts the real AgentKit chat (the
 * transcript scroller plus the chat template's Markdown text renderer) over
 * the current page, feeds it a recorded or synthetic chunk timeline through
 * an in-memory transport, and measures every frame. No request leaves the
 * page and no model runs. See README.md for how to load it.
 */
import { AgentKitClient } from "@agent-native/agentkit/client";
import type {
  AgentEvent,
  AgentMessage,
  AgentThreadSnapshot,
  AgentTransport,
} from "@agent-native/agentkit/protocol";
import { createRoot, type Root } from "react-dom/client";

import { AgentChat } from "../../src/app/agentkit/react/chat.js";
import { AgentKitMarkdownText } from "../../src/app/chat/agentkit-chat/parity-renderers.js";
import {
  countMarkdownWords,
  recordFrames,
  type CodeWordCounting,
  type FrameSample,
  type ReplayMetrics,
} from "./metrics.js";
import {
  recordedTimeline,
  SAMPLE_MARKDOWN,
  syntheticTimeline,
  timelineText,
  type ReplayTimeline,
  type SyntheticTimelineKind,
} from "./timelines.js";

export interface ReplayOptions {
  timeline: ReplayTimeline;
  /** Earlier turns shown above the reply, so the transcript can scroll. */
  historyTurns?: number;
  width?: number;
  /** Scroll up by this much at this time (ms after the run starts). */
  userScroll?: { at: number; pixels: number };
  /** Press jump to latest at this time (ms after the run starts). */
  jumpToLatestAt?: number;
  /** Leave the replay on screen after measuring. */
  keepOpen?: boolean;
  /** Return every frame sample too. */
  includeSamples?: boolean;
  codeWordCounting?: CodeWordCounting;
}

export interface UserScrollCheck {
  unpinnedAfterScroll: boolean;
  /** Frames after the user scrolled up in which the view moved back down. */
  framesPulledBack: number;
  repinnedAfterJump?: boolean;
  atBottomAfterJump?: boolean;
}

export interface ReplayResult extends ReplayMetrics {
  userScroll?: UserScrollCheck;
  samples?: FrameSample[];
}

export interface HistoryLoadResult {
  /** Frames from the history rendering until the view rests at the bottom. */
  framesToBottom: number;
  /**
   * Largest single-frame scroll movement after the first painted position.
   * The jump from 0 to that position is the landing itself, which should be
   * one snap; counting it would hide later shifts, such as older rows
   * mounting above the view.
   */
  largestStepPx: number;
  distanceFromBottomPx: number;
}

if (!import.meta.env.DEV) {
  throw new Error("The streaming replay harness only runs in dev builds.");
}

/** Transport calls, for diagnosing a replay that never starts. */
export const replayLog: string[] = [];

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const nextFrame = () =>
  new Promise<number>((resolve) => requestAnimationFrame(resolve));

function historyMessages(turns: number): AgentMessage[] {
  const paragraphs = SAMPLE_MARKDOWN.split("\n\n").filter(
    (block) => !block.startsWith("|") && !block.startsWith("```"),
  );
  return Array.from({ length: turns }, (_, index) => [
    {
      id: `history-user-${index}`,
      role: "user" as const,
      parts: [{ type: "text" as const, text: `Earlier question ${index + 1}` }],
      status: "complete" as const,
    },
    {
      id: `history-assistant-${index}`,
      role: "assistant" as const,
      parts: [
        {
          type: "text" as const,
          text: paragraphs.join("\n\n"),
          format: "markdown" as const,
        },
      ],
      status: "complete" as const,
    },
  ]).flat();
}

function replayTransport({
  threadId,
  history,
  timeline,
  onStart,
  onDeliver,
}: {
  threadId: string;
  history: AgentMessage[];
  timeline: ReplayTimeline | null;
  onStart: (startedAt: number) => void;
  onDeliver: (text: string) => void;
}): AgentTransport {
  const runId = `${threadId}-run`;
  const messageId = `${threadId}-reply`;
  let sequence = 0;
  let subscriptions = 0;
  const event = (fields: Record<string, unknown>): AgentEvent =>
    ({
      id: `${runId}:${++sequence}`,
      threadId,
      runId,
      sequence,
      occurredAt: new Date().toISOString(),
      ...fields,
    }) as AgentEvent;

  return {
    async assertAiSetupReady() {},
    async getThreadSnapshot(): Promise<AgentThreadSnapshot> {
      const now = new Date().toISOString();
      return {
        id: threadId,
        title: "Streaming replay",
        createdAt: now,
        updatedAt: now,
        messages: history,
      } as AgentThreadSnapshot;
    },
    async startRun() {
      return { runId };
    },
    async *subscribeToRun({ signal }) {
      replayLog.push(`subscribe ${subscriptions}`);
      // A reconnect after the replay finished has nothing new to send.
      if (!timeline || subscriptions++ > 0) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else
            signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return;
      }
      const startedAt = performance.now();
      onStart(startedAt);
      yield event({ type: "run.started" });
      yield event({
        type: "message.created",
        message: {
          id: messageId,
          role: "assistant",
          parts: [],
          status: "streaming",
        },
      });
      let text = "";
      for (const chunk of timeline.chunks) {
        const delay = startedAt + chunk.at - performance.now();
        if (delay > 0) await wait(delay);
        if (signal?.aborted) return;
        text += chunk.text;
        onDeliver(text);
        yield event({
          type: "message.delta",
          messageId,
          text: chunk.text,
          format: "markdown",
        });
      }
      const doneDelay = startedAt + timeline.doneAt - performance.now();
      if (doneDelay > 0) await wait(doneDelay);
      yield event({
        type: "message.completed",
        message: {
          id: messageId,
          role: "assistant",
          parts: [{ type: "text", text, format: "markdown" }],
          status: "complete",
        },
      });
      yield event({ type: "run.completed" });
    },
    async cancelRun() {},
  };
}

interface Mounted {
  root: Root;
  host: HTMLElement;
  client: AgentKitClient;
  threadId: string;
  transcript: HTMLElement;
}

async function mount({
  history,
  timeline,
  width,
  onStart,
  onDeliver,
}: {
  history: AgentMessage[];
  timeline: ReplayTimeline | null;
  width: number;
  onStart: (startedAt: number) => void;
  onDeliver: (text: string) => void;
}): Promise<Mounted> {
  const threadId = `streaming-replay-${Date.now().toString(36)}`;
  const host = document.createElement("div");
  host.setAttribute("data-streaming-replay", "true");
  host.className = "bg-background text-foreground";
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483000",
    display: "flex",
    justifyContent: "center",
  });
  const frame = document.createElement("div");
  Object.assign(frame.style, {
    width: `min(${width}px, 100vw)`,
    height: "100vh",
    display: "flex",
    flexDirection: "column",
  });
  host.append(frame);
  document.body.append(host);

  const client = new AgentKitClient({
    transport: replayTransport({
      threadId,
      history,
      timeline,
      onStart,
      onDeliver,
    }),
  });
  const root = createRoot(frame);
  root.render(
    <AgentChat
      client={client}
      threadId={threadId}
      composer={false}
      slots={{ text: AgentKitMarkdownText }}
      className="h-full"
    />,
  );

  let transcript: HTMLElement | null = null;
  // The empty state lays the transcript out without scrolling; wait for the
  // history to render.
  for (let attempt = 0; attempt < 600; attempt += 1) {
    await nextFrame();
    transcript = frame.querySelector<HTMLElement>(".agentkit-transcript");
    if (
      transcript &&
      (history.length === 0 || transcript.querySelector(".agent-markdown"))
    ) {
      break;
    }
  }
  const scrolls =
    transcript && /auto|scroll/.test(getComputedStyle(transcript).overflowY);
  if (!transcript || !scrolls) {
    root.unmount();
    host.remove();
    throw new Error(
      transcript
        ? "AgentKit styles are not loaded on this page; open a chat page first."
        : "The AgentKit transcript never mounted.",
    );
  }
  return { root, host, client, threadId, transcript };
}

function unmount(mounted: Mounted): void {
  mounted.root.unmount();
  mounted.host.remove();
  void mounted.client.dispose();
}

/** Replays `timeline` and returns per-frame metrics. */
export async function runReplay({
  timeline,
  historyTurns = 2,
  width = 760,
  userScroll,
  jumpToLatestAt,
  keepOpen = false,
  includeSamples = false,
  codeWordCounting = "units",
}: ReplayOptions): Promise<ReplayResult> {
  let delivered = "";
  let startedAt = 0;
  const mounted = await mount({
    history: historyMessages(historyTurns),
    timeline,
    width,
    onStart: (at) => (startedAt = at),
    onDeliver: (text) => (delivered = text),
  });
  const { transcript } = mounted;
  // Let the history render and settle at the bottom first.
  for (let index = 0; index < 30; index += 1) await nextFrame();

  const recorder = recordFrames({
    transcript,
    reply: () => {
      const replies = transcript.querySelectorAll(".agent-markdown");
      return replies.length > historyTurns
        ? replies.item(replies.length - 1)
        : null;
    },
    receivedWords: () => countMarkdownWords(delivered, codeWordCounting),
    counting: codeWordCounting,
  });

  replayLog.push("send");
  await mounted.client.sendMessage({
    threadId: mounted.threadId,
    text: timeline.prompt,
  });
  replayLog.push("sent");
  while (startedAt === 0) await nextFrame();

  let scrollCheck: UserScrollCheck | undefined;
  const pending: Promise<void>[] = [];
  if (userScroll) {
    pending.push(
      (async () => {
        await wait(startedAt + userScroll.at - performance.now());
        transcript.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -userScroll.pixels,
            bubbles: true,
          }),
        );
        transcript.scrollTop -= userScroll.pixels;
        const scrolledTo = transcript.scrollTop;
        await nextFrame();
        await nextFrame();
        const unpinned = transcript.getAttribute("data-follow") === "false";
        let pulledBack = 0;
        let last = scrolledTo;
        const until =
          jumpToLatestAt === undefined
            ? startedAt + timeline.doneAt
            : startedAt + jumpToLatestAt;
        while (performance.now() < until) {
          await nextFrame();
          if (transcript.scrollTop > last + 1) pulledBack += 1;
          last = transcript.scrollTop;
        }
        scrollCheck = {
          unpinnedAfterScroll: unpinned,
          framesPulledBack: pulledBack,
        };
        if (jumpToLatestAt !== undefined) {
          transcript.parentElement
            ?.querySelector<HTMLButtonElement>(
              ".agentkit-scroll-to-bottom-control button",
            )
            ?.click();
          await wait(700);
          scrollCheck.repinnedAfterJump =
            transcript.getAttribute("data-follow") === "true";
          scrollCheck.atBottomAfterJump =
            transcript.scrollHeight -
              transcript.clientHeight -
              transcript.scrollTop <=
            24;
        }
      })(),
    );
  }

  await wait(startedAt + timeline.doneAt - performance.now());
  await Promise.all(pending);
  // Wait for the drain to finish: no new word for a second.
  let lastWords = -1;
  let quietSince = performance.now();
  while (performance.now() - quietSince < 1_000) {
    await nextFrame();
    const words = recorder.samples.at(-1)?.visibleWords ?? 0;
    if (words !== lastWords) {
      lastWords = words;
      quietSince = performance.now();
    }
  }
  const metrics = recorder.metrics({
    timeline: timeline.name,
    startedAt,
    firstChunkAt: timeline.chunks[0]?.at ?? 0,
    doneAt: timeline.doneAt,
  });
  if (!keepOpen) unmount(mounted);
  return {
    ...metrics,
    ...(scrollCheck ? { userScroll: scrollCheck } : {}),
    ...(includeSamples
      ? {
          samples: recorder.samples.map((sample) => ({
            ...sample,
            t: Math.round(sample.t - startedAt),
          })),
        }
      : {}),
  };
}

/** Opens a thread with long history and measures how it lands at the bottom. */
export async function measureHistoryLoad(
  historyTurns = 12,
  width = 760,
): Promise<HistoryLoadResult> {
  const mounted = await mount({
    history: historyMessages(historyTurns),
    timeline: null,
    width,
    onStart: () => {},
    onDeliver: () => {},
  });
  const { transcript } = mounted;
  const positions: number[] = [];
  let restingFrames = 0;
  let frames = 0;
  let landedAt = -1;
  while (frames < 240 && restingFrames < 30) {
    await nextFrame();
    frames += 1;
    positions.push(transcript.scrollTop);
    const distance =
      transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop;
    const hasHistory =
      transcript.querySelectorAll(".agent-markdown").length > 0;
    if (hasHistory && distance <= 1) {
      if (landedAt < 0) landedAt = frames;
      restingFrames += 1;
    } else {
      landedAt = -1;
      restingFrames = 0;
    }
  }
  const firstRendered = positions.findIndex((position) => position > 0);
  const steps: number[] = [];
  let previous: number | null = null;
  for (const position of positions.slice(Math.max(0, firstRendered))) {
    if (previous !== null) steps.push(Math.abs(position - previous));
    previous = position;
  }
  const result = {
    framesToBottom: landedAt < 0 ? -1 : landedAt - Math.max(0, firstRendered),
    largestStepPx: Math.round(Math.max(0, ...steps)),
    distanceFromBottomPx: Math.round(
      transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop,
    ),
  };
  unmount(mounted);
  return result;
}

/**
 * Builds a timeline from a stored run in the dev database, using the thread's
 * persisted events for timing and the run's event replay for the deltas.
 */
export async function captureRecordedTimeline({
  threadId,
  runId,
  name = runId,
}: {
  threadId: string;
  runId: string;
  name?: string;
}): Promise<ReplayTimeline> {
  const threadResponse = await fetch(
    `/_agent-native/agent-chat/threads/${encodeURIComponent(threadId)}`,
  );
  if (!threadResponse.ok) {
    throw new Error(
      `Thread ${threadId} failed to load: ${threadResponse.status}`,
    );
  }
  const thread = (await threadResponse.json()) as { threadData: string };
  const threadData = JSON.parse(thread.threadData) as {
    agentKit?: {
      events?: Parameters<typeof recordedTimeline>[0]["persistedEvents"];
    };
    messages: {
      message: { role: string; content?: { type: string; text?: string }[] };
    }[];
  };
  const persistedEvents = threadData.agentKit?.events;
  if (!persistedEvents) throw new Error(`Thread ${threadId} has no events.`);

  const eventsResponse = await fetch(
    `/_agent-native/agent-chat/runs/${encodeURIComponent(runId)}/events?threadId=${encodeURIComponent(threadId)}&afterSequence=0`,
    { headers: { accept: "text/event-stream" } },
  );
  if (!eventsResponse.ok) {
    throw new Error(
      `Run ${runId} events failed to load: ${eventsResponse.status}`,
    );
  }
  const rawEvents = (await eventsResponse.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map(
      (line) =>
        JSON.parse(line.slice(6)) as {
          type: string;
          text?: string;
          seq: number;
        },
    );
  return recordedTimeline({
    name,
    prompt: `Replay of ${runId}`,
    persistedEvents,
    rawEvents,
    runId,
  });
}

export interface ReplaySuite {
  [timeline: string]: ReplayResult;
}

/** Runs every synthetic timeline, plus `recorded` when given. */
export async function runSuite(
  recorded?: ReplayTimeline,
): Promise<ReplaySuite> {
  const suite: ReplaySuite = {};
  const kinds: SyntheticTimelineKind[] = [
    "steady",
    "bursty",
    "very-fast",
    "stall-flood",
  ];
  for (const kind of kinds) {
    suite[kind] = await runReplay({ timeline: syntheticTimeline(kind) });
  }
  if (recorded) suite[recorded.name] = await runReplay({ timeline: recorded });
  return suite;
}

const api = {
  replayLog,
  runReplay,
  runSuite,
  measureHistoryLoad,
  captureRecordedTimeline,
  syntheticTimeline,
  timelineText,
};

declare global {
  interface Window {
    streamingReplay?: typeof api;
  }
}

window.streamingReplay = api;
