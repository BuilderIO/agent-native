import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fireInternalDispatch: vi.fn(async () => {}),
  getH3App: vi.fn(),
  readBody: vi.fn(),
  registerDispatcher: vi.fn(),
  processImport: vi.fn(),
  processDue: vi.fn(async () => ({ discovered: 0, dispatched: 0, failed: 0 })),
  h3Use: vi.fn(),
  verifyInternalToken: vi.fn(() => true),
  isLocalDatabase: vi.fn(() => true),
}));

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  isLocalDatabase: mocks.isLocalDatabase,
}));

vi.mock("@agent-native/core/server", () => ({
  awaitBootstrap: vi.fn(async () => {}),
  extractInternalBearerToken: vi.fn(() => "token"),
  fireInternalDispatch: mocks.fireInternalDispatch,
  FRAMEWORK_ROUTE_PREFIX: "/_agent-native",
  getH3App: mocks.getH3App,
  readBody: mocks.readBody,
  verifyInternalToken: mocks.verifyInternalToken,
}));

vi.mock("./worker.js", () => ({
  processCreativeContextImportJob: mocks.processImport,
  processDueCreativeContextImportJobs: mocks.processDue,
  registerCreativeContextImportContinuationDispatcher: mocks.registerDispatcher,
}));

vi.mock("./background-worker.js", () => ({
  enqueueCreativeContextDailyMaintenance: vi.fn(async () => ({
    discovered: 0,
    queued: 0,
    failed: 0,
  })),
  processCreativeContextBackgroundJob: vi.fn(),
  processDueCreativeContextBackgroundJobs: vi.fn(async () => ({
    discovered: 0,
    dispatched: 0,
    failed: 0,
  })),
  registerCreativeContextBackgroundDispatcher: vi.fn(),
}));

const {
  CREATIVE_CONTEXT_IMPORT_PROCESSOR_ROUTE,
  createCreativeContextWorkerPlugin,
} = await import("./server-worker.js");

describe("creative context hosted worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T17:00:00.000Z"));
    mocks.fireInternalDispatch.mockClear();
    mocks.registerDispatcher.mockClear();
    mocks.processDue.mockClear();
    mocks.h3Use.mockClear();
    mocks.verifyInternalToken.mockReset();
    mocks.verifyInternalToken.mockReturnValue(true);
    mocks.isLocalDatabase.mockReset();
    mocks.isLocalDatabase.mockReturnValue(true);
    mocks.getH3App.mockReturnValue({ use: mocks.h3Use });
    mocks.readBody.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mounts the processor, sweeps durable jobs, and schedules a future quota resume", async () => {
    const nitroApp = {};
    await createCreativeContextWorkerPlugin({ appId: "slides" })(nitroApp);

    expect(mocks.h3Use).toHaveBeenCalledWith(
      CREATIVE_CONTEXT_IMPORT_PROCESSOR_ROUTE,
      expect.any(Function),
    );
    expect(mocks.processDue).toHaveBeenCalledWith({ appId: "slides" });
    const dispatcher = mocks.registerDispatcher.mock.calls[0]?.[0] as (
      input: Record<string, unknown>,
    ) => Promise<void>;
    await dispatcher({
      jobId: "job-1",
      ownerEmail: "owner@example.com",
      appId: "slides",
      resumeAt: "2026-07-16T17:01:00.000Z",
    });
    expect(mocks.fireInternalDispatch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.fireInternalDispatch).toHaveBeenCalledWith({
      path: CREATIVE_CONTEXT_IMPORT_PROCESSOR_ROUTE,
      taskId: "job-1",
      body: expect.objectContaining({
        jobId: "job-1",
        ownerEmail: "owner@example.com",
        appId: "slides",
      }),
    });
    expect(mocks.processDue).toHaveBeenCalledTimes(2);
  });

  it("keeps a caller-supplied dispatcher when requested", async () => {
    await createCreativeContextWorkerPlugin({
      appId: "content",
      registerDispatcher: false,
    })({});
    expect(mocks.registerDispatcher).not.toHaveBeenCalled();
  });

  it("rejects invalid signed dispatches", async () => {
    vi.stubEnv("A2A_SECRET", "configured-secret");
    mocks.verifyInternalToken.mockReturnValue(false);
    mocks.readBody.mockResolvedValue({
      jobId: "job-invalid",
      ownerEmail: "owner@example.com",
    });
    await createCreativeContextWorkerPlugin({ appId: "design" })({});
    const handler = mocks.h3Use.mock.calls.at(-1)?.[1] as (
      event: unknown,
    ) => Promise<Response>;
    const response = await handler({
      req: {
        method: "POST",
        headers: new Headers({ authorization: "Bearer invalid" }),
      },
    });
    expect(response.status).toBe(401);
    expect(mocks.processImport).not.toHaveBeenCalled();
  });

  it("fails closed without A2A_SECRET outside local development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.isLocalDatabase.mockReturnValue(false);
    mocks.readBody.mockResolvedValue({
      jobId: "job-hosted",
      ownerEmail: "owner@example.com",
    });
    await createCreativeContextWorkerPlugin({ appId: "assets" })({});
    const handler = mocks.h3Use.mock.calls.at(-1)?.[1] as (
      event: unknown,
    ) => Promise<Response>;
    const response = await handler({
      req: { method: "POST", headers: new Headers() },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("A2A_SECRET"),
    });
    expect(mocks.processImport).not.toHaveBeenCalled();
  });
});
