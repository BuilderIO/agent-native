import { describe, expect, it, vi } from "vitest";

import {
  RESTART_CAPTURE_ENDED_MESSAGE,
  recorderWithCaptureSuspension,
  resolveRestartHandoff,
  type RecorderHandle,
  type RestartHandoff,
  type StartParams,
} from "./recorder";

function fakeStream(...readyStates: Array<"live" | "ended">): MediaStream {
  const tracks = readyStates.map((readyState) => ({
    readyState,
    stop: vi.fn(function stop(this: { readyState: string }) {
      this.readyState = "ended";
    }),
  }));
  return { getTracks: () => tracks } as unknown as MediaStream;
}

function restartParams(handoff: Partial<RestartHandoff>): StartParams {
  return {
    serverUrl: "http://localhost:8080",
    mode: "screen",
    micOn: true,
    cameraOn: false,
    preAcquiredDisplayStream: handoff.displayStream ?? null,
    preAcquiredAudioStream: handoff.audioStream ?? null,
  };
}

function stubHandle(overrides: Partial<RecorderHandle> = {}): RecorderHandle {
  return {
    stop: vi.fn(async () => ({ recordingId: "rec_1", viewUrl: "/r/rec_1" })),
    cancel: vi.fn(async () => {}),
    discardForRestart: vi.fn(async () => ({
      displayStream: null,
      audioStream: null,
    })),
    ...overrides,
  };
}

describe("resolveRestartHandoff", () => {
  it("passes through a restart with no handed-off capture", () => {
    expect(resolveRestartHandoff(restartParams({}), true, true)).toEqual({
      displayStream: null,
      audioStream: null,
    });
  });

  it("keeps live handed-off display and mic capture", () => {
    const display = fakeStream("live", "live");
    const audio = fakeStream("live");

    expect(
      resolveRestartHandoff(
        restartParams({ displayStream: display, audioStream: audio }),
        true,
        true,
      ),
    ).toEqual({ displayStream: display, audioStream: audio });
    expect(
      [...display.getTracks(), ...audio.getTracks()].every(
        (track) => track.readyState === "live",
      ),
    ).toBe(true);
  });

  it("reports the ended share rather than silently re-acquiring", () => {
    const display = fakeStream("ended");
    const audio = fakeStream("live");

    expect(() =>
      resolveRestartHandoff(
        restartParams({ displayStream: display, audioStream: audio }),
        true,
        true,
      ),
    ).toThrow(RESTART_CAPTURE_ENDED_MESSAGE);
    // The surviving mic must not be left running behind a failed restart.
    expect(audio.getTracks()[0].readyState).toBe("ended");
  });

  it("treats a track-less handed-off display stream as dead capture", () => {
    expect(() =>
      resolveRestartHandoff(
        restartParams({ displayStream: fakeStream() }),
        true,
        true,
      ),
    ).toThrow(RESTART_CAPTURE_ENDED_MESSAGE);
  });

  it("drops a dead mic for re-acquisition instead of failing a live restart", () => {
    const display = fakeStream("live");
    const audio = fakeStream("ended");

    expect(
      resolveRestartHandoff(
        restartParams({ displayStream: display, audioStream: audio }),
        true,
        true,
      ),
    ).toEqual({ displayStream: display, audioStream: null });
    expect(display.getTracks()[0].readyState).toBe("live");
  });

  it("stops handed-off capture the new session no longer wants", () => {
    const display = fakeStream("live");
    const audio = fakeStream("live");

    expect(
      resolveRestartHandoff(
        restartParams({ displayStream: display, audioStream: audio }),
        true,
        false,
      ),
    ).toEqual({ displayStream: display, audioStream: null });
    expect(audio.getTracks()[0].readyState).toBe("ended");
  });
});

describe("recorderWithCaptureSuspension", () => {
  it("releases the capture lease so the retake can re-acquire it", async () => {
    const release = vi.fn(async () => {});
    const display = fakeStream("live");
    const handle = recorderWithCaptureSuspension(
      stubHandle({
        discardForRestart: vi.fn(async () => ({
          displayStream: display,
          audioStream: null,
        })),
      }),
      release,
    );

    await expect(handle.discardForRestart()).resolves.toEqual({
      displayStream: display,
      audioStream: null,
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("discards only once when restart is clicked twice", async () => {
    const discard = vi.fn(async () => ({
      displayStream: null,
      audioStream: null,
    }));
    const handle = recorderWithCaptureSuspension(
      stubHandle({ discardForRestart: discard }),
      async () => {},
    );

    const [first, second] = await Promise.all([
      handle.discardForRestart(),
      handle.discardForRestart(),
    ]);

    expect(first).toBe(second);
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it("refuses to hand off capture from an already stopped recording", async () => {
    const discard = vi.fn(async () => ({
      displayStream: null,
      audioStream: null,
    }));
    const handle = recorderWithCaptureSuspension(
      stubHandle({ discardForRestart: discard }),
      async () => {},
    );

    await handle.stop();

    await expect(handle.discardForRestart()).rejects.toThrow(
      "Recording was already stopped",
    );
    expect(discard).not.toHaveBeenCalled();
  });

  it("refuses to finalize a take that was discarded for a restart", async () => {
    const stop = vi.fn(async () => ({
      recordingId: "rec_1",
      viewUrl: "/r/rec_1",
    }));
    const handle = recorderWithCaptureSuspension(
      stubHandle({ stop }),
      async () => {},
    );

    await handle.discardForRestart();

    await expect(handle.stop()).rejects.toThrow(
      "Recording was already discarded for a restart",
    );
    expect(stop).not.toHaveBeenCalled();
  });

  it("stops handed-off capture when the take is cancelled instead of retaken", async () => {
    const display = fakeStream("live");
    const audio = fakeStream("live");
    const cancel = vi.fn(async () => {});
    const handle = recorderWithCaptureSuspension(
      stubHandle({
        cancel,
        discardForRestart: vi.fn(async () => ({
          displayStream: display,
          audioStream: audio,
        })),
      }),
      async () => {},
    );

    await handle.discardForRestart();
    await handle.cancel();

    // The backend still gets its cancel — it owns whatever session teardown a
    // restart deliberately skipped.
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(display.getTracks()[0].readyState).toBe("ended");
    expect(audio.getTracks()[0].readyState).toBe("ended");
  });

  it("keeps the handoff when releasing the capture lease fails", async () => {
    const display = fakeStream("live");
    const handle = recorderWithCaptureSuspension(
      stubHandle({
        discardForRestart: vi.fn(async () => ({
          displayStream: display,
          audioStream: null,
        })),
      }),
      async () => {
        throw new Error("lease release failed");
      },
    );

    // Losing the handoff here would strand a live screen capture with nobody
    // holding a reference to stop it.
    await expect(handle.discardForRestart()).resolves.toEqual({
      displayStream: display,
      audioStream: null,
    });
  });

  it("refuses to hand off capture from an already cancelled recording", async () => {
    const discard = vi.fn(async () => ({
      displayStream: null,
      audioStream: null,
    }));
    const handle = recorderWithCaptureSuspension(
      stubHandle({ discardForRestart: discard }),
      async () => {},
    );

    await handle.cancel();

    await expect(handle.discardForRestart()).rejects.toThrow(
      "Recording was already cancelled",
    );
    expect(discard).not.toHaveBeenCalled();
  });
});
