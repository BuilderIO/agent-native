import { afterEach, describe, expect, it, vi } from "vitest";

import * as googleDocs from "./adapters/google-docs.js";
import * as configStore from "./config-store.js";
import {
  processChanges,
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

const pollerOptions = {
  systemPrompt: "",
  actions: {},
  model: "test-model",
  apiKey: "test-key",
  ownerEmail: "owner@example.com",
};

/** Starts the poller with Docs disabled and runs it until its poll job exists. */
async function startPollJob(): Promise<void> {
  vi.useFakeTimers();
  await startGoogleDocsPoller(pollerOptions);
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

  it("gives up on a stop request that stalls", async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(timeout.signal);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal!.reason),
            );
          }),
      ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const stopping = stopGoogleDocsWatchChannel(
      "access-token",
      "channel-1",
      "resource-1",
    );
    timeout.abort(new DOMException("The operation timed out.", "TimeoutError"));

    await expect(stopping).resolves.toBe(false);
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
  }, 2_000);

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

describe("Google Docs change processing", () => {
  const docChange = {
    fileId: "doc-1",
    removed: false,
    file: {
      id: "doc-1",
      name: "Doc",
      mimeType: "application/vnd.google-apps.document",
    },
  };

  /** Keeps saved integration config in memory, starting from `initial`. */
  function useConfig(initial: Record<string, Record<string, unknown>>) {
    const saved = new Map(Object.entries(initial));
    vi.spyOn(configStore, "getIntegrationConfig").mockImplementation(
      async (_platform, key = "default") => {
        const configData = saved.get(key);
        return configData
          ? ({ configData } as unknown as configStore.IntegrationConfig)
          : null;
      },
    );
    vi.spyOn(configStore, "listIntegrationConfigs").mockImplementation(
      async () =>
        [...saved].map(
          ([configKey, configData]) =>
            ({ configKey, configData }) as configStore.IntegrationConfig,
        ),
    );
    vi.spyOn(configStore, "saveIntegrationConfig").mockImplementation(
      async (_platform, configData, key = "default") => {
        saved.set(key, configData);
      },
    );
    vi.spyOn(configStore, "deleteIntegrationConfig").mockImplementation(
      async (_platform, key = "default") => {
        saved.delete(key);
      },
    );
    vi.spyOn(googleDocs, "getServiceAccountAccessToken").mockResolvedValue(
      "access-token",
    );
    vi.spyOn(googleDocs, "getServiceAccountEmail").mockReturnValue(null);
    vi.spyOn(console, "error").mockImplementation(() => {});
    return saved;
  }

  it("checks a document again on the next poll when its comment check fails", async () => {
    const saved = useConfig({ "page-token": { pageToken: "token-1" } });
    vi.spyOn(googleDocs, "listChanges")
      .mockResolvedValueOnce({ changes: [docChange], nextPageToken: "token-2" })
      .mockResolvedValueOnce({ changes: [], nextPageToken: "token-3" });
    const listComments = vi
      .spyOn(googleDocs, "listDocComments")
      .mockRejectedValueOnce(new Error("Drive unavailable"))
      .mockResolvedValueOnce([]);

    await processChanges(pollerOptions);
    expect(Object.fromEntries(saved)).toEqual({
      "page-token": { pageToken: "token-2" },
      "comment-retry:doc-1": { attempts: 1 },
    });

    await processChanges(pollerOptions);
    expect(listComments).toHaveBeenCalledTimes(2);
    expect(listComments).toHaveBeenLastCalledWith(
      "doc-1",
      "access-token",
      undefined,
    );
    expect(Object.fromEntries(saved)).toEqual({
      "page-token": { pageToken: "token-3" },
    });
  });

  it("gives up on a document after five failed checks", async () => {
    const saved = useConfig({
      "page-token": { pageToken: "token-1" },
      "comment-retry:doc-1": { attempts: 4 },
    });
    vi.spyOn(googleDocs, "listChanges").mockResolvedValue({
      changes: [],
      nextPageToken: "token-2",
    });
    vi.spyOn(googleDocs, "listDocComments").mockRejectedValue(
      new Error("File not found"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await processChanges(pollerOptions);

    expect(Object.fromEntries(saved)).toEqual({
      "page-token": { pageToken: "token-2" },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Giving up on comments in doc-1"),
    );
  });

  it("counts a malformed retry row as one failed check", async () => {
    const saved = useConfig({
      "page-token": { pageToken: "token-1" },
      "comment-retry:doc-1": { attempts: "4" },
      "comment-retry:doc-2": { attempts: -3 },
    });
    vi.spyOn(googleDocs, "listChanges").mockResolvedValue({
      changes: [],
      nextPageToken: "token-2",
    });
    vi.spyOn(googleDocs, "listDocComments").mockRejectedValue(
      new Error("Drive unavailable"),
    );

    await processChanges(pollerOptions);

    expect(saved.get("comment-retry:doc-1")).toEqual({ attempts: 2 });
    expect(saved.get("comment-retry:doc-2")).toEqual({ attempts: 2 });
  });

  it("keeps a failure another poll records while this one runs", async () => {
    const saved = useConfig({
      "page-token": { pageToken: "token-1" },
      "comment-retry:doc-1": { attempts: 1 },
    });
    vi.spyOn(googleDocs, "listChanges").mockResolvedValue({
      changes: [],
      nextPageToken: "token-2",
    });
    vi.spyOn(googleDocs, "listDocComments").mockImplementation(async () => {
      // A push notification's poll records doc-2 while this one is checking.
      saved.set("comment-retry:doc-2", { attempts: 1 });
      return [];
    });

    await processChanges(pollerOptions);

    expect(Object.fromEntries(saved)).toEqual({
      "page-token": { pageToken: "token-2" },
      "comment-retry:doc-2": { attempts: 1 },
    });
  });
});
