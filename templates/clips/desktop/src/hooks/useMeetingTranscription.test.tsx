// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => {
  const listeners = new Map<
    string,
    Set<(event: { payload: unknown }) => void>
  >();
  return {
    listeners,
    invoke: vi.fn(
      async (_command: string, _args?: unknown): Promise<unknown> => null,
    ),
    emit: vi.fn(async (name: string, payload: unknown) => {
      for (const listener of listeners.get(name) ?? []) listener({ payload });
    }),
    listen: vi.fn(
      async (name: string, listener: (event: { payload: unknown }) => void) => {
        const handlers = listeners.get(name) ?? new Set();
        handlers.add(listener);
        listeners.set(name, handlers);
        return () => handlers.delete(listener);
      },
    ),
  };
});

const transcription = vi.hoisted(() => ({
  start: vi.fn(async () => "whisper" as const),
  stop: vi.fn(async (): Promise<void> => undefined),
  restart: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: tauri.emit,
  listen: tauri.listen,
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => {}) }));
vi.mock("../lib/meeting-call-app", () => ({
  callAppBundleIdsForJoinUrl: vi.fn(() => []),
}));
vi.mock("../lib/silence-events", () => ({
  subscribeAutoStop: vi.fn(() => () => {}),
}));
vi.mock("../lib/transcription-engine", () => ({
  appendFinalTranscript: vi.fn(() => false),
  onFinalTranscript: vi.fn(async () => () => {}),
  restartTranscriptionEngine: transcription.restart,
  startTranscriptionEngine: transcription.start,
  stopTranscriptionEngine: transcription.stop,
  transcriptFullText: vi.fn(() => ""),
  transcriptLineFromSegment: vi.fn(),
  transcriptSegments: vi.fn(() => []),
}));

import { useMeetingTranscription } from "./useMeetingTranscription";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for the meeting hook.");
}

function Probe({
  callClipsAction,
}: {
  callClipsAction: (name: string) => unknown;
}) {
  useMeetingTranscription({
    callClipsAction: callClipsAction as never,
    serverUrl: "https://clips.example",
    selectedMicId: null,
    selectedMicLabel: null,
    enabled: true,
  });
  return null;
}

describe("useMeetingTranscription quit coordination", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    tauri.listeners.clear();
    tauri.invoke.mockReset();
    tauri.invoke.mockImplementation(async () => null);
    tauri.emit.mockClear();
    tauri.listen.mockClear();
    transcription.start.mockReset();
    transcription.stop.mockReset();
    transcription.restart.mockReset();
    transcription.stop.mockResolvedValue(undefined);
    transcription.restart.mockResolvedValue(undefined);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("waits for start-failure teardown before acknowledging app quit", async () => {
    const engineStart = deferred<"whisper">();
    const startRecording = deferred<{
      meetingId: string;
      recording: { id: string };
    }>();
    const stopRecording = deferred<{ actualEnd: string }>();
    transcription.start.mockReturnValue(engineStart.promise);

    const callClipsAction = vi.fn((name: string) => {
      if (name === "start-meeting-recording") return startRecording.promise;
      if (name === "stop-meeting-recording") return stopRecording.promise;
      if (name === "get-meeting")
        return Promise.resolve({ meeting: { title: "Meeting" } });
      return Promise.resolve({});
    });

    await act(async () => {
      root.render(<Probe callClipsAction={callClipsAction} />);
    });

    const startListener = [
      ...(tauri.listeners.get("meetings:start-transcription") ?? []),
    ][0];
    const quitListener = [
      ...(tauri.listeners.get("meetings:quit-requested") ?? []),
    ][0];
    expect(startListener).toBeDefined();
    expect(quitListener).toBeDefined();

    await act(async () => {
      startListener!({ payload: { meetingId: "meeting-1" } });
      await waitFor(() =>
        callClipsAction.mock.calls.some(
          ([name]) => name === "start-meeting-recording",
        ),
      );
    });

    await act(async () => {
      startRecording.reject(new Error("Recording could not start."));
      await Promise.resolve();
    });

    await act(async () => {
      quitListener!({ payload: undefined });
      await Promise.resolve();
    });

    expect(tauri.invoke).not.toHaveBeenCalledWith("quit_teardown_done");

    await act(async () => {
      engineStart.resolve("whisper");
      await waitFor(() =>
        callClipsAction.mock.calls.some(
          ([name]) => name === "stop-meeting-recording",
        ),
      );
    });

    expect(transcription.stop).toHaveBeenCalledWith("whisper");

    expect(tauri.invoke).not.toHaveBeenCalledWith("quit_teardown_done");

    await act(async () => {
      stopRecording.resolve({ actualEnd: new Date().toISOString() });
      await waitFor(() =>
        tauri.invoke.mock.calls.some(([name]) => name === "quit_teardown_done"),
      );
    });

    expect(tauri.invoke).toHaveBeenCalledWith("quit_teardown_done");
  });

  it("waits for a pre-session start check before acknowledging quit", async () => {
    const historyStatus = deferred<{ available: boolean }>();
    tauri.invoke.mockImplementation(async (command) => {
      if (command === "rewind_meeting_history_status") {
        return historyStatus.promise;
      }
      return null;
    });
    const callClipsAction = vi.fn(async () => ({}));

    await act(async () => {
      root.render(<Probe callClipsAction={callClipsAction} />);
    });
    const startListener = [
      ...(tauri.listeners.get("meetings:start-transcription") ?? []),
    ][0];
    const quitListener = [
      ...(tauri.listeners.get("meetings:quit-requested") ?? []),
    ][0];
    expect(startListener).toBeDefined();
    expect(quitListener).toBeDefined();

    await act(async () => {
      startListener!({
        payload: {
          meetingId: "meeting-1",
          reason: "user",
          scheduledStart: new Date().toISOString(),
        },
      });
      await waitFor(() =>
        tauri.invoke.mock.calls.some(
          ([command]) => command === "rewind_meeting_history_status",
        ),
      );
    });

    await act(async () => {
      quitListener!({ payload: undefined });
      await Promise.resolve();
    });
    expect(tauri.invoke).not.toHaveBeenCalledWith("quit_teardown_done");

    await act(async () => {
      historyStatus.resolve({ available: false });
      await waitFor(() =>
        tauri.invoke.mock.calls.some(
          ([command]) => command === "quit_teardown_done",
        ),
      );
    });

    expect(transcription.start).not.toHaveBeenCalled();
    expect(callClipsAction).not.toHaveBeenCalled();
    expect(tauri.invoke).not.toHaveBeenCalledWith(
      "rewind_meeting_history_prepare",
      expect.anything(),
    );
  });

  it("lets startup continue when quit is cancelled while checking history", async () => {
    const historyStatus = deferred<{ available: boolean }>();
    tauri.invoke.mockImplementation(async (command) => {
      if (command === "rewind_meeting_history_status") {
        return historyStatus.promise;
      }
      return null;
    });
    const callClipsAction = vi.fn((name: string) => {
      if (name === "start-meeting-recording") {
        return Promise.resolve({
          meetingId: "meeting-1",
          recording: { id: "recording-1" },
        });
      }
      if (name === "get-meeting") {
        return Promise.resolve({ meeting: { title: "Meeting" } });
      }
      return Promise.resolve({});
    });

    await act(async () => {
      root.render(<Probe callClipsAction={callClipsAction} />);
    });
    const startListener = [
      ...(tauri.listeners.get("meetings:start-transcription") ?? []),
    ][0];
    const quitListener = [
      ...(tauri.listeners.get("meetings:quit-requested") ?? []),
    ][0];
    const cancelQuitListener = [
      ...(tauri.listeners.get("meetings:quit-cancelled") ?? []),
    ][0];
    expect(startListener).toBeDefined();
    expect(quitListener).toBeDefined();
    expect(cancelQuitListener).toBeDefined();

    await act(async () => {
      startListener!({
        payload: {
          meetingId: "meeting-1",
          reason: "user",
          scheduledStart: new Date().toISOString(),
        },
      });
      await waitFor(() =>
        tauri.invoke.mock.calls.some(
          ([command]) => command === "rewind_meeting_history_status",
        ),
      );
    });

    await act(async () => {
      quitListener!({ payload: undefined });
      cancelQuitListener!({ payload: undefined });
      historyStatus.resolve({ available: false });
      await waitFor(() => transcription.start.mock.calls.length > 0);
    });

    expect(
      callClipsAction.mock.calls.some(
        ([name]) => name === "start-meeting-recording",
      ),
    ).toBe(true);
    expect(
      callClipsAction.mock.calls.some(
        ([name]) => name === "stop-meeting-recording",
      ),
    ).toBe(false);
    expect(tauri.invoke).not.toHaveBeenCalledWith("quit_teardown_done");
  });

  it("waits for engine startup and stop before closing an app-quit session", async () => {
    const engineStart = deferred<"whisper">();
    const engineStop = deferred<void>();
    const stopRecording = deferred<{ actualEnd: string }>();
    transcription.start.mockReturnValue(engineStart.promise);
    transcription.stop.mockReturnValue(engineStop.promise);
    const callClipsAction = vi.fn((name: string) => {
      if (name === "start-meeting-recording") {
        return Promise.resolve({
          meetingId: "meeting-1",
          recording: { id: "recording-1" },
        });
      }
      if (name === "stop-meeting-recording") return stopRecording.promise;
      if (name === "get-meeting") {
        return Promise.resolve({ meeting: { title: "Meeting" } });
      }
      return Promise.resolve({});
    });

    await act(async () => {
      root.render(<Probe callClipsAction={callClipsAction} />);
    });
    const startListener = [
      ...(tauri.listeners.get("meetings:start-transcription") ?? []),
    ][0];
    const quitListener = [
      ...(tauri.listeners.get("meetings:quit-requested") ?? []),
    ][0];
    expect(startListener).toBeDefined();
    expect(quitListener).toBeDefined();

    await act(async () => {
      startListener!({ payload: { meetingId: "meeting-1" } });
      await waitFor(() =>
        callClipsAction.mock.calls.some(([name]) => name === "get-meeting"),
      );
    });

    await act(async () => {
      quitListener!({ payload: undefined });
      await Promise.resolve();
    });

    expect(transcription.stop).not.toHaveBeenCalled();
    expect(
      callClipsAction.mock.calls.some(
        ([name]) => name === "stop-meeting-recording",
      ),
    ).toBe(false);
    expect(tauri.invoke).not.toHaveBeenCalledWith("quit_teardown_done");

    await act(async () => {
      engineStart.resolve("whisper");
      await waitFor(() => transcription.stop.mock.calls.length === 1);
    });

    expect(transcription.stop).toHaveBeenCalledWith("whisper");
    expect(
      callClipsAction.mock.calls.some(
        ([name]) => name === "stop-meeting-recording",
      ),
    ).toBe(false);
    expect(tauri.invoke).not.toHaveBeenCalledWith("quit_teardown_done");

    await act(async () => {
      engineStop.resolve();
      await waitFor(() =>
        callClipsAction.mock.calls.some(
          ([name]) => name === "stop-meeting-recording",
        ),
      );
    });
    expect(tauri.invoke).not.toHaveBeenCalledWith("quit_teardown_done");

    await act(async () => {
      stopRecording.resolve({ actualEnd: new Date().toISOString() });
      await waitFor(() =>
        tauri.invoke.mock.calls.some(
          ([command]) => command === "quit_teardown_done",
        ),
      );
    });

    expect(
      callClipsAction.mock.calls.filter(
        ([name]) => name === "stop-meeting-recording",
      ),
    ).toHaveLength(1);
    expect(tauri.invoke).toHaveBeenCalledWith("quit_teardown_done");
  });

  it("keeps quit attached to the active stop when startup fails", async () => {
    const engineStart = deferred<"whisper">();
    const startRecording = deferred<{
      meetingId: string;
      recording: { id: string };
    }>();
    const stopRecording = deferred<{ actualEnd: string }>();
    transcription.start.mockReturnValue(engineStart.promise);
    const callClipsAction = vi.fn((name: string) => {
      if (name === "start-meeting-recording") return startRecording.promise;
      if (name === "stop-meeting-recording") return stopRecording.promise;
      return Promise.resolve({});
    });

    await act(async () => {
      root.render(<Probe callClipsAction={callClipsAction} />);
    });
    const startListener = [
      ...(tauri.listeners.get("meetings:start-transcription") ?? []),
    ][0];
    const quitListener = [
      ...(tauri.listeners.get("meetings:quit-requested") ?? []),
    ][0];
    expect(startListener).toBeDefined();
    expect(quitListener).toBeDefined();

    await act(async () => {
      startListener!({ payload: { meetingId: "meeting-1" } });
      await waitFor(() =>
        callClipsAction.mock.calls.some(
          ([name]) => name === "start-meeting-recording",
        ),
      );
    });
    await act(async () => {
      quitListener!({ payload: undefined });
      await Promise.resolve();
    });
    startRecording.reject(new Error("Recording could not start."));

    expect(
      callClipsAction.mock.calls.some(
        ([name]) => name === "stop-meeting-recording",
      ),
    ).toBe(false);
    await act(async () => {
      engineStart.resolve("whisper");
      await waitFor(() =>
        callClipsAction.mock.calls.some(
          ([name]) => name === "stop-meeting-recording",
        ),
      );
    });
    expect(
      callClipsAction.mock.calls.filter(
        ([name]) => name === "stop-meeting-recording",
      ),
    ).toHaveLength(1);
    expect(tauri.invoke).not.toHaveBeenCalledWith("quit_teardown_done");

    await act(async () => {
      stopRecording.resolve({ actualEnd: new Date().toISOString() });
      await waitFor(() =>
        tauri.invoke.mock.calls.some(
          ([command]) => command === "quit_teardown_done",
        ),
      );
    });

    expect(tauri.invoke).toHaveBeenCalledWith("quit_teardown_done");
    expect(
      callClipsAction.mock.calls.filter(
        ([name]) => name === "stop-meeting-recording",
      ),
    ).toHaveLength(1);
  });

  it("keeps a failed start stop retryable instead of acknowledging quit", async () => {
    const engineStart = deferred<"whisper">();
    const startRecording = deferred<{
      meetingId: string;
      recording: { id: string };
    }>();
    const stopError = new Error("Temporary stop failure.");
    let stopAttempts = 0;
    transcription.start.mockReturnValue(engineStart.promise);
    const callClipsAction = vi.fn((name: string) => {
      if (name === "start-meeting-recording") return startRecording.promise;
      if (name === "stop-meeting-recording") {
        stopAttempts += 1;
        if (stopAttempts === 1) return Promise.reject(stopError);
        return Promise.resolve({ actualEnd: new Date().toISOString() });
      }
      return Promise.resolve({});
    });

    await act(async () => {
      root.render(<Probe callClipsAction={callClipsAction} />);
    });
    const startListener = [
      ...(tauri.listeners.get("meetings:start-transcription") ?? []),
    ][0];
    const quitListener = [
      ...(tauri.listeners.get("meetings:quit-requested") ?? []),
    ][0];
    expect(startListener).toBeDefined();
    expect(quitListener).toBeDefined();

    await act(async () => {
      startListener!({ payload: { meetingId: "meeting-1" } });
      await waitFor(() =>
        callClipsAction.mock.calls.some(
          ([name]) => name === "start-meeting-recording",
        ),
      );
    });
    startRecording.reject(new Error("Recording could not start."));
    await act(async () => {
      engineStart.resolve("whisper");
      await waitFor(() => stopAttempts === 1);
    });
    expect(tauri.invoke).not.toHaveBeenCalledWith("quit_teardown_done");

    await act(async () => {
      quitListener!({ payload: undefined });
      await waitFor(() =>
        tauri.invoke.mock.calls.some(
          ([command]) => command === "quit_teardown_done",
        ),
      );
    });

    expect(stopAttempts).toBe(2);
    expect(tauri.invoke).toHaveBeenCalledWith("quit_teardown_done");
  });
});
