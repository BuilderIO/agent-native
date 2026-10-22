import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: vi.fn<(...args: any[]) => Promise<any>>(),
  save: vi.fn(),
  promote: vi.fn(),
  changes: vi.fn(),
  comments: vi.fn(),
  startRun: vi.fn(),
}));
vi.mock("./config-store.js", () => ({
  getIntegrationConfig: mocks.config,
  saveIntegrationConfig: mocks.save,
  saveIntegrationConfigIfUnchanged: mocks.promote,
  integrationConfigWriteEpoch: () => 0,
}));
vi.mock("./adapters/google-docs.js", () => ({
  getServiceAccountEmail: () => null,
  getServiceAccountAccessToken: async () => "test-token",
  listChanges: mocks.changes,
  listDocComments: mocks.comments,
  googleDocsAdapter: () => ({}),
}));
vi.mock("./thread-mapping-store.js", () => ({
  getThreadMapping: async () => null,
  saveThreadMapping: async () => {},
}));
vi.mock("./request-scope.js", () => ({
  resolveIntegrationRequestScope: async () => ({}),
  integrationRequestContext: () => ({}),
}));
vi.mock("../server/request-context.js", () => ({
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));
vi.mock("../chat-threads/store.js", () => ({
  createThread: async () => ({ id: "test-thread" }),
  getThread: async () => null,
  setThreadSourceIfMissing: async () => {},
}));
vi.mock("../agent/engine/index.js", () => ({
  createAnthropicEngine: () => ({ name: "test-engine" }),
  registerBuiltinEngines: () => {},
}));
vi.mock("../agent/run-manager.js", () => ({ startRun: mocks.startRun }));

import {
  handlePushNotification,
  startGoogleDocsPoller,
  stopGoogleDocsPoller,
  shutdownGoogleDocsPoller,
} from "./google-docs-poller.js";

const options = {
  systemPrompt: "test",
  actions: {},
  model: "test",
  apiKey: "",
  ownerEmail: "owner@example.test",
};
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.config.mockImplementation(async (_platform, id) => ({
    configData:
      id === "page-token" ? { pageToken: "cursor" } : { enabled: false },
  }));
  mocks.changes.mockResolvedValue({ changes: [], nextPageToken: "next" });
});
afterEach(async () => {
  await shutdownGoogleDocsPoller();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Google Docs service lifecycle", () => {
  it("drains admitted push processing and its child run while rejecting late pushes", async () => {
    await startGoogleDocsPoller(options);
    const changes = deferred<any>();
    const finalized = deferred();
    mocks.changes.mockReturnValueOnce(changes.promise);
    mocks.comments.mockResolvedValue([
      {
        id: "push-comment",
        content: "@agent hello",
        author: { displayName: "Test" },
      },
    ]);
    mocks.startRun.mockReturnValue({ finalized: finalized.promise });
    const push = handlePushNotification();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.changes).toHaveBeenCalledOnce();

    let closed = false;
    const closing = shutdownGoogleDocsPoller().then(() => {
      closed = true;
    });
    try {
      await handlePushNotification();
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.changes).toHaveBeenCalledOnce();
      expect(closed).toBe(false);

      changes.resolve({
        changes: [{ fileId: "push-document" }],
        nextPageToken: "next",
      });
      await push;
      expect(mocks.startRun).toHaveBeenCalledOnce();
      expect(closed).toBe(false);

      finalized.resolve();
      await closing;
      await handlePushNotification();
      expect(mocks.changes).toHaveBeenCalledOnce();
      expect(mocks.startRun).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      changes.resolve({ changes: [], nextPageToken: "next" });
      finalized.resolve();
      await push;
      await closing;
    }
  });

  it.each([false, true])(
    "disables without waiting for a stalled poll and fences restart (shutdown=%s)",
    async (shutdown) => {
      mocks.config.mockImplementation(async (_platform, id) => ({
        configData:
          id === "page-token" ? { pageToken: "cursor" } : { enabled: true },
      }));
      const changes = deferred<any>();
      mocks.changes.mockReturnValueOnce(changes.promise);
      await startGoogleDocsPoller(options);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(mocks.changes).toHaveBeenCalledOnce();

      let disabled = false;
      const disabling = stopGoogleDocsPoller().then(() => {
        disabled = true;
      });
      let closing: Promise<void> | undefined;
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(disabled).toBe(true);
        await disabling;
        await startGoogleDocsPoller(options);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(mocks.changes).toHaveBeenCalledOnce();
        // A second toggle must supersede the restart waiting on the old poll.
        await stopGoogleDocsPoller();
        await startGoogleDocsPoller(options);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(mocks.changes).toHaveBeenCalledOnce();

        let closed = false;
        if (shutdown) {
          closing = shutdownGoogleDocsPoller().then(() => {
            closed = true;
          });
          await vi.advanceTimersByTimeAsync(0);
          expect(closed).toBe(false);
        }
        changes.resolve({ changes: [], nextPageToken: "next" });
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.changes).toHaveBeenCalledTimes(shutdown ? 1 : 2);
        if (shutdown) {
          await closing;
          expect(closed).toBe(true);
          expect(vi.getTimerCount()).toBe(0);
        }
      } finally {
        changes.resolve({ changes: [], nextPageToken: "next" });
        await disabling;
        await closing;
      }
    },
  );

  it("cancels the pending first poll without reading configuration again", async () => {
    await startGoogleDocsPoller(options);
    await shutdownGoogleDocsPoller();
    mocks.config.mockClear();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mocks.config).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a repeated shutdown supersedes a restart waiting for the previous poll to drain", async () => {
    await startGoogleDocsPoller(options);
    const gate = deferred<any>();
    mocks.config.mockReturnValueOnce(gate.promise);
    await vi.advanceTimersByTimeAsync(5_000);
    const closing = shutdownGoogleDocsPoller();
    const restarting = startGoogleDocsPoller(options);
    const closingAgain = shutdownGoogleDocsPoller();
    gate.resolve({ configData: { enabled: false } });
    await Promise.all([closing, restarting, closingAgain]);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mocks.config).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await startGoogleDocsPoller(options);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.config).toHaveBeenCalledTimes(4);
  });

  it("drains finalization of a child run launched by an already-admitted poll", async () => {
    await startGoogleDocsPoller(options);
    const poll = deferred<any>();
    const finalized = deferred();
    mocks.config.mockReturnValueOnce(poll.promise);
    mocks.changes.mockResolvedValue({
      changes: [{ fileId: "test-document" }],
      nextPageToken: "next",
    });
    mocks.comments.mockResolvedValue([
      {
        id: "test-comment",
        content: "@agent hello",
        author: { displayName: "Test" },
      },
    ]);
    mocks.startRun.mockReturnValue({ finalized: finalized.promise });
    await vi.advanceTimersByTimeAsync(5_000);
    let closed = false;
    const closing = shutdownGoogleDocsPoller().then(() => {
      closed = true;
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(closed).toBe(false);
      poll.resolve({ configData: { enabled: true } });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.startRun).toHaveBeenCalledOnce();
      expect(closed).toBe(false);
      finalized.resolve();
      await closing;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      poll.resolve({ configData: { enabled: false } });
      finalized.resolve();
      await closing;
    }
  });

  it("retains a late child failure while its parent poll is still draining", async () => {
    await startGoogleDocsPoller(options);
    const changes = deferred<any>();
    const secondDocument = deferred<any>();
    const finalized = deferred();
    mocks.config.mockResolvedValueOnce({ configData: { enabled: true } });
    mocks.changes.mockReturnValueOnce(changes.promise);
    mocks.comments
      .mockResolvedValueOnce([
        {
          id: "late-failed-child",
          content: "@agent hello",
          author: { displayName: "Test" },
        },
      ])
      .mockReturnValueOnce(secondDocument.promise);
    mocks.startRun.mockReturnValue({ finalized: finalized.promise });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.changes).toHaveBeenCalledOnce();
    const closing = shutdownGoogleDocsPoller();
    const outcome = Promise.allSettled([closing]);
    try {
      changes.resolve({
        changes: [{ fileId: "child-document" }, { fileId: "blocked-document" }],
        nextPageToken: "next",
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.startRun).toHaveBeenCalledOnce();
      expect(mocks.comments).toHaveBeenCalledTimes(2);
      const error = new Error("child failed before parent settled");
      finalized.reject(error);
      await vi.advanceTimersByTimeAsync(0);
      secondDocument.resolve([]);
      expect(await outcome).toEqual([
        {
          status: "rejected",
          reason: expect.objectContaining({
            message: "Google Docs shutdown failed",
            errors: [error],
          }),
        },
      ]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      changes.resolve({ changes: [], nextPageToken: "next" });
      secondDocument.resolve([]);
      finalized.resolve();
      await outcome;
    }
  });

  it("preserves a promoted watch when shutdown races renewal, including after a duplicate start", async () => {
    let watch: any = null;
    mocks.config.mockImplementation(async (_platform, id) =>
      id === "watch-channel"
        ? watch
        : {
            configData:
              id === "page-token" ? { pageToken: "cursor" } : { enabled: true },
          },
    );
    const promotion = deferred();
    let promotions = 0;
    mocks.promote.mockImplementation(async (_platform, data) => {
      watch = { configData: data };
      if (++promotions === 2) await promotion.promise;
      return true;
    });
    const registered: string[] = [];
    const revoked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        if (url.endsWith("/channels/stop")) {
          revoked.push(body.id);
          return { ok: true, status: 204 };
        }
        registered.push(body.id);
        return {
          ok: true,
          json: async () => ({
            id: body.id,
            resourceId: "resource",
            expiration: String(Date.now() + 24 * 60 * 60 * 1000),
          }),
        };
      }),
    );
    const pushOptions = {
      ...options,
      webhookUrl: "https://example.test/webhook",
    };
    await startGoogleDocsPoller(pushOptions);
    await startGoogleDocsPoller(pushOptions);
    await vi.advanceTimersByTimeAsync(22 * 60 * 60 * 1000);
    const closing = shutdownGoogleDocsPoller();
    try {
      expect(promotions).toBe(2);
      promotion.resolve();
      await closing;
      expect(watch.configData.channelId).toBe(registered[1]);
      expect(revoked).toEqual([registered[0]]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      promotion.resolve();
      await closing;
    }
  });

  it("allows a fresh start after shutdown reports a child finalization failure", async () => {
    await startGoogleDocsPoller(options);
    const finalized = deferred();
    mocks.changes.mockResolvedValue({
      changes: [{ fileId: "failed-push-document" }],
      nextPageToken: "next",
    });
    mocks.comments.mockResolvedValue([
      {
        id: "failed-push-comment",
        content: "@agent hello",
        author: { displayName: "Test" },
      },
    ]);
    mocks.startRun.mockReturnValue({ finalized: finalized.promise });
    await handlePushNotification();
    expect(mocks.startRun).toHaveBeenCalledOnce();

    const closing = shutdownGoogleDocsPoller();
    const failedShutdown = expect(closing).rejects.toThrow(
      "Google Docs shutdown failed",
    );
    finalized.reject(new Error("finalization failed"));
    await failedShutdown;

    mocks.config.mockClear();
    await startGoogleDocsPoller(options);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.config).toHaveBeenCalledTimes(2);
    await shutdownGoogleDocsPoller();
    expect(vi.getTimerCount()).toBe(0);
  });
});
