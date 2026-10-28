import { afterEach, describe, expect, it, vi } from "vitest";

import * as configStore from "./config-store.js";
import {
  startGoogleDocsPoller,
  stopGoogleDocsPoller,
  stopGoogleDocsWatchChannel,
} from "./google-docs-poller.js";

const pollJob = vi.hoisted(() => ({ stop: vi.fn<() => Promise<void>>() }));
vi.mock("../server/interval-job.js", () => ({
  startIntervalJob: vi.fn(() => ({ stop: pollJob.stop })),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  pollJob.stop.mockReset();
});

/** Starts the poller with Docs disabled and runs it until its poll job exists. */
async function startPollJob(): Promise<void> {
  vi.useFakeTimers();
  await startGoogleDocsPoller({
    systemPrompt: "",
    actions: {},
    model: "test-model",
    apiKey: "test-key",
    ownerEmail: "owner@example.com",
  });
  // The poll loop creates its job 5 s after the poller starts.
  vi.advanceTimersByTime(5_000);
  vi.useRealTimers();
}

describe("Google Docs watch channel cleanup", () => {
  it("only reports success for an accepted stop request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      stopGoogleDocsWatchChannel("access-token", "channel-1", "resource-1"),
    ).resolves.toBe(true);
    await expect(
      stopGoogleDocsWatchChannel("access-token", "channel-2", "resource-2"),
    ).resolves.toBe(true);
    await expect(
      stopGoogleDocsWatchChannel("access-token", "channel-3", "resource-3"),
    ).resolves.toBe(false);
  });

  it("treats a network failure as an unsuccessful stop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network unavailable")),
    );

    await expect(
      stopGoogleDocsWatchChannel("access-token", "channel-1", "resource-1"),
    ).resolves.toBe(false);
  });

  it("retires the watch without waiting on a poll in flight when Docs is turned off", async () => {
    const readConfig = vi
      .spyOn(configStore, "getIntegrationConfig")
      .mockResolvedValue(null);
    await startPollJob();
    pollJob.stop.mockReturnValue(new Promise<void>(() => {}));

    await stopGoogleDocsPoller();

    expect(pollJob.stop).toHaveBeenCalledOnce();
    expect(readConfig).toHaveBeenCalledWith("google-docs", "watch-channel");
  }, 2_000);

  it("waits for a poll in flight and keeps the shared watch when the server shuts down", async () => {
    const readConfig = vi
      .spyOn(configStore, "getIntegrationConfig")
      .mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await startPollJob();
    let finishPoll!: () => void;
    pollJob.stop.mockReturnValue(
      new Promise<void>((resolve) => {
        finishPoll = resolve;
      }),
    );

    let stopped = false;
    const stopping = stopGoogleDocsPoller({ shuttingDown: true }).then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stopped).toBe(false);

    finishPoll();
    await stopping;
    expect(readConfig).not.toHaveBeenCalledWith("google-docs", "watch-channel");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
