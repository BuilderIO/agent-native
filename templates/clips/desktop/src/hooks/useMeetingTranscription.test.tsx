// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { payload?: unknown }) => void>>(),
  finalListeners: new Set<
    (event: {
      text: string;
      source: "mic" | "system";
      segments: Array<{ startMs: number; endMs: number; text: string }>;
      runId?: number;
    }) => void
  >(),
  invoke: vi.fn(),
  emit: vi.fn(),
  startTranscriptionEngine: vi.fn(),
  stopTranscriptionEngine: vi.fn(),
  restartTranscriptionEngine: vi.fn(),
  actions: [] as Array<{ name: string; body: Record<string, unknown> }>,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: mocks.emit,
  listen: async (
    name: string,
    handler: (event: { payload?: unknown }) => void,
  ) => {
    const handlers = mocks.listeners.get(name) ?? new Set();
    handlers.add(handler);
    mocks.listeners.set(name, handlers);
    return () => handlers.delete(handler);
  },
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("../lib/silence-events", () => ({
  subscribeAutoStop: async () => () => {},
}));
vi.mock("../lib/transcription-engine", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/transcription-engine")
  >("../lib/transcription-engine");
  return {
    ...actual,
    onFinalTranscript: async (listener: (event: unknown) => void) => {
      mocks.finalListeners.add(listener as never);
      return () => mocks.finalListeners.delete(listener as never);
    },
    startTranscriptionEngine: mocks.startTranscriptionEngine,
    stopTranscriptionEngine: mocks.stopTranscriptionEngine,
    restartTranscriptionEngine: mocks.restartTranscriptionEngine,
  };
});

import { useMeetingTranscription } from "./useMeetingTranscription";

function Harness() {
  useMeetingTranscription({
    callClipsAction: async <T,>(
      name: string,
      body: Record<string, unknown>,
    ) => {
      mocks.actions.push({ name, body });
      if (name === "start-meeting-recording") {
        return {
          meetingId: "meeting-1",
          recording: { id: "recording-1" },
        } as T;
      }
      if (name === "get-meeting") {
        return { meeting: {}, transcript: null } as T;
      }
      return undefined as T;
    },
    serverUrl: "https://clips.test",
    selectedMicId: null,
    selectedMicLabel: null,
    enabled: true,
  });
  return null;
}

async function settle() {
  for (let index = 0; index < 30; index++) await Promise.resolve();
}

async function dispatch(name: string, payload: unknown = {}) {
  await act(async () => {
    for (const handler of mocks.listeners.get(name) ?? []) {
      handler({ payload });
    }
    await settle();
  });
}

function emitFinal(runId: number, text: string) {
  for (const listener of mocks.finalListeners) {
    listener({
      runId,
      text,
      source: "mic",
      segments: [{ startMs: 0, endMs: 100, text }],
    });
  }
}

describe("meeting transcription pause and resume", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.listeners.clear();
    mocks.finalListeners.clear();
    mocks.actions.length = 0;
    mocks.invoke.mockReset().mockResolvedValue(undefined);
    mocks.emit.mockReset().mockResolvedValue(undefined);
    mocks.startTranscriptionEngine.mockReset().mockResolvedValue("whisper");
    mocks.stopTranscriptionEngine.mockReset().mockResolvedValue(undefined);
    mocks.restartTranscriptionEngine.mockReset().mockResolvedValue(undefined);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("accepts paused-run finals through the settle window after resume", async () => {
    await act(async () => {
      root.render(createElement(Harness));
      await settle();
    });
    await dispatch("meetings:start-transcription", { meetingId: "meeting-1" });

    const pausedRunId = mocks.startTranscriptionEngine.mock.calls[0][0]
      .runId as number;
    expect(pausedRunId).toEqual(expect.any(Number));

    await dispatch("clips:recorder-pause");
    expect(mocks.stopTranscriptionEngine).toHaveBeenCalledWith(
      "whisper",
      pausedRunId,
    );

    await act(async () => {
      emitFinal(pausedRunId, "late paused engine final");
      vi.setSystemTime(Date.now() + 1_501);
      emitFinal(pausedRunId, "stale during long pause");
      await settle();
    });

    await dispatch("clips:recorder-resume");
    const resumedRunId = mocks.restartTranscriptionEngine.mock
      .calls[0][5] as number;
    expect(resumedRunId).toEqual(expect.any(Number));
    expect(resumedRunId).not.toBe(pausedRunId);

    await act(async () => {
      emitFinal(pausedRunId, "stale after resume");
      emitFinal(resumedRunId, "after resume");
      await settle();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
      await settle();
    });

    const savedTranscripts = mocks.actions.filter(
      (action) => action.name === "save-browser-transcript",
    );
    expect(savedTranscripts).toHaveLength(1);
    expect(savedTranscripts[0].body.fullText).toBe(
      "Me: late paused engine final\n\nMe: after resume",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      emitFinal(pausedRunId, "stale paused engine final");
      await vi.advanceTimersByTimeAsync(1_500);
      await settle();
    });
    expect(
      mocks.actions.filter(
        (action) => action.name === "save-browser-transcript",
      ),
    ).toHaveLength(1);
  });
});
