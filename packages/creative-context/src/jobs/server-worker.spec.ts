import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  signInternalToken,
  verifyInternalToken as verifySignedInternalToken,
} from "../../../core/src/integrations/internal-token.js";

const mocks = vi.hoisted(() => ({
  fireInternalDispatch: vi.fn(async () => {}),
  extractInternalBearerToken: vi.fn(),
  getH3App: vi.fn(),
  readBody: vi.fn(),
  registerDispatcher: vi.fn(),
  processImport: vi.fn(),
  processDue: vi.fn(async () => ({ discovered: 0, dispatched: 0, failed: 0 })),
  processDueBackground: vi.fn(async () => ({
    discovered: 0,
    dispatched: 0,
    failed: 0,
  })),
  enqueueDailyMaintenance: vi.fn(async () => ({
    discovered: 0,
    queued: 0,
    failed: 0,
  })),
  h3Use: vi.fn(),
  verifyInternalToken: vi.fn(),
  processBackground: vi.fn(),
  isLocalDatabase: vi.fn(() => true),
  isInBackgroundFunctionRuntime: vi.fn(() => false),
  isProductionServerlessFunctionRuntime: vi.fn(() => false),
  recurringSweepHandlers: new Map<string, () => Promise<void>>(),
  registerRecurringSweepHandler: vi.fn(),
  scheduledTriggerAvailability: vi.fn(() => ({
    available: true,
    driver: "netlify-scheduled-function",
  })),
}));

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  isLocalDatabase: mocks.isLocalDatabase,
  isProductionServerlessFunctionRuntime:
    mocks.isProductionServerlessFunctionRuntime,
}));

vi.mock("@agent-native/core/server", () => ({
  awaitBootstrap: vi.fn(async () => {}),
  extractInternalBearerToken: mocks.extractInternalBearerToken,
  fireInternalDispatch: mocks.fireInternalDispatch,
  FRAMEWORK_ROUTE_PREFIX: "/_agent-native",
  getH3App: mocks.getH3App,
  isInBackgroundFunctionRuntime: mocks.isInBackgroundFunctionRuntime,
  readBody: mocks.readBody,
  registerRecurringSweepHandler: mocks.registerRecurringSweepHandler,
  scheduledTriggerAvailability: mocks.scheduledTriggerAvailability,
  verifyInternalToken: mocks.verifyInternalToken,
}));

vi.mock("./worker.js", () => ({
  processCreativeContextImportJob: mocks.processImport,
  processDueCreativeContextImportJobs: mocks.processDue,
  registerCreativeContextImportContinuationDispatcher: mocks.registerDispatcher,
}));

vi.mock("./background-worker.js", () => ({
  enqueueCreativeContextDailyMaintenance: mocks.enqueueDailyMaintenance,
  processCreativeContextBackgroundJob: mocks.processBackground,
  processDueCreativeContextBackgroundJobs: mocks.processDueBackground,
  registerCreativeContextBackgroundDispatcher: vi.fn(),
}));

const {
  CREATIVE_CONTEXT_BACKGROUND_PROCESSOR_ROUTE,
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
    mocks.processDueBackground.mockClear();
    mocks.enqueueDailyMaintenance.mockClear();
    mocks.processImport.mockReset();
    mocks.processImport.mockResolvedValue({
      yielded: false,
      reason: "completed",
      job: { status: "completed" },
    });
    mocks.processBackground.mockReset();
    mocks.processBackground.mockResolvedValue({ status: "completed" });
    mocks.extractInternalBearerToken.mockReset();
    mocks.extractInternalBearerToken.mockImplementation(
      (authorization?: string) =>
        authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null,
    );
    mocks.h3Use.mockClear();
    mocks.verifyInternalToken.mockReset();
    mocks.verifyInternalToken.mockImplementation(verifySignedInternalToken);
    mocks.isLocalDatabase.mockReset();
    mocks.isLocalDatabase.mockReturnValue(true);
    mocks.isInBackgroundFunctionRuntime.mockReset();
    mocks.isInBackgroundFunctionRuntime.mockReturnValue(false);
    mocks.isProductionServerlessFunctionRuntime.mockReset();
    mocks.isProductionServerlessFunctionRuntime.mockReturnValue(false);
    mocks.registerRecurringSweepHandler.mockReset();
    mocks.registerRecurringSweepHandler.mockImplementation(
      (id: string, handler: () => Promise<void>) => {
        mocks.recurringSweepHandlers.set(id, handler);
        return () => mocks.recurringSweepHandlers.delete(id);
      },
    );
    mocks.scheduledTriggerAvailability.mockReset();
    mocks.scheduledTriggerAvailability.mockReturnValue({
      available: true,
      driver: "netlify-scheduled-function",
    });
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

  it("keeps the in-process sweep and maintenance timers on long-running servers", async () => {
    await createCreativeContextWorkerPlugin({ appId: "long-running" })({});

    expect(mocks.processDue).toHaveBeenCalledWith({ appId: "long-running" });
    expect(mocks.processDueBackground).toHaveBeenCalledWith({
      appId: "long-running",
    });
    expect(mocks.enqueueDailyMaintenance).toHaveBeenCalledWith({
      appId: "long-running",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.processDue).toHaveBeenCalledTimes(2);
  });

  it("does no database work at boot in production serverless runtimes and leaves the sweep to the platform scheduler", async () => {
    mocks.isProductionServerlessFunctionRuntime.mockReturnValue(true);

    await createCreativeContextWorkerPlugin({ appId: "serverless" })({});

    expect(mocks.h3Use).toHaveBeenCalledWith(
      CREATIVE_CONTEXT_IMPORT_PROCESSOR_ROUTE,
      expect.any(Function),
    );
    expect(mocks.processDue).not.toHaveBeenCalled();
    expect(mocks.processDueBackground).not.toHaveBeenCalled();
    expect(mocks.enqueueDailyMaintenance).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(mocks.processDue).not.toHaveBeenCalled();
    expect(mocks.enqueueDailyMaintenance).not.toHaveBeenCalled();

    const sweep = mocks.recurringSweepHandlers.get(
      "creative-context:serverless",
    );
    expect(sweep).toBeTypeOf("function");
    await sweep!();
    expect(mocks.processDue).toHaveBeenCalledWith({ appId: "serverless" });
    expect(mocks.processDueBackground).toHaveBeenCalledWith({
      appId: "serverless",
    });
    expect(mocks.enqueueDailyMaintenance).toHaveBeenCalledWith({
      appId: "serverless",
    });
  });

  it("scans for daily maintenance only on the hourly sweep tick", async () => {
    mocks.isProductionServerlessFunctionRuntime.mockReturnValue(true);
    await createCreativeContextWorkerPlugin({ appId: "serverless-hourly" })({});
    const sweep = mocks.recurringSweepHandlers.get(
      "creative-context:serverless-hourly",
    );

    vi.setSystemTime(new Date("2026-07-16T17:01:00.000Z"));
    await sweep!();
    expect(mocks.processDue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueDailyMaintenance).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-07-16T18:00:00.000Z"));
    await sweep!();
    expect(mocks.enqueueDailyMaintenance).toHaveBeenCalledTimes(1);
  });

  it("warns when a serverless runtime has no platform scheduler for the sweep", async () => {
    mocks.isProductionServerlessFunctionRuntime.mockReturnValue(true);
    mocks.scheduledTriggerAvailability.mockReturnValue({
      available: false,
      reason: "no-platform-scheduler",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await createCreativeContextWorkerPlugin({ appId: "serverless-vercel" })({});

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no platform scheduler"),
    );
    expect(mocks.processDue).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("fails the scheduled sweep loudly when due jobs cannot be dispatched", async () => {
    mocks.isProductionServerlessFunctionRuntime.mockReturnValue(true);
    await createCreativeContextWorkerPlugin({ appId: "serverless-failing" })(
      {},
    );
    mocks.processDueBackground.mockResolvedValueOnce({
      discovered: 2,
      dispatched: 1,
      failed: 1,
    });

    const sweep = mocks.recurringSweepHandlers.get(
      "creative-context:serverless-failing",
    );
    await expect(sweep!()).rejects.toThrow(/1 due background dispatch/);
  });

  it("keeps a caller-supplied dispatcher when requested", async () => {
    await createCreativeContextWorkerPlugin({
      appId: "content",
      registerDispatcher: false,
    })({});
    expect(mocks.registerDispatcher).not.toHaveBeenCalled();
  });

  it("mounts processors without starting database sweeps in background runtime", async () => {
    mocks.isInBackgroundFunctionRuntime.mockReturnValue(true);

    await createCreativeContextWorkerPlugin({ appId: "analytics" })({});

    expect(mocks.h3Use).toHaveBeenCalledWith(
      CREATIVE_CONTEXT_IMPORT_PROCESSOR_ROUTE,
      expect.any(Function),
    );
    expect(mocks.processDue).not.toHaveBeenCalled();
    expect(mocks.processDueBackground).not.toHaveBeenCalled();
    expect(mocks.enqueueDailyMaintenance).not.toHaveBeenCalled();
  });

  it("rejects invalid signed dispatches for both processors", async () => {
    vi.stubEnv("A2A_SECRET", "configured-secret");
    mocks.verifyInternalToken.mockReturnValue(false);

    for (const [route, processor] of [
      [CREATIVE_CONTEXT_IMPORT_PROCESSOR_ROUTE, mocks.processImport],
      [CREATIVE_CONTEXT_BACKGROUND_PROCESSOR_ROUTE, mocks.processBackground],
    ] as const) {
      mocks.readBody.mockResolvedValue({
        jobId: `job-invalid-${route.endsWith("background") ? "background" : "import"}`,
        ownerEmail: "owner@example.com",
      });
      await createCreativeContextWorkerPlugin({ appId: "design" })({});
      const handler = mocks.h3Use.mock.calls.find(
        ([mountedRoute]) => mountedRoute === route,
      )?.[1] as ((event: unknown) => Promise<Response>) | undefined;
      expect(handler).toBeTypeOf("function");

      const response = await handler!({
        req: {
          method: "POST",
          headers: new Headers({ authorization: "Bearer invalid" }),
        },
      });

      expect(response.status).toBe(401);
      expect(processor).not.toHaveBeenCalled();
    }
  });

  it("accepts valid signed dispatches for both processors", async () => {
    vi.stubEnv("A2A_SECRET", "configured-secret");

    for (const [route, processor] of [
      [CREATIVE_CONTEXT_IMPORT_PROCESSOR_ROUTE, mocks.processImport],
      [CREATIVE_CONTEXT_BACKGROUND_PROCESSOR_ROUTE, mocks.processBackground],
    ] as const) {
      const jobId = `job-valid-${route.endsWith("background") ? "background" : "import"}`;
      mocks.readBody.mockResolvedValue({
        jobId,
        ownerEmail: "owner@example.com",
      });
      await createCreativeContextWorkerPlugin({ appId: "design" })({});
      const handler = mocks.h3Use.mock.calls.find(
        ([mountedRoute]) => mountedRoute === route,
      )?.[1] as ((event: unknown) => Promise<Response>) | undefined;
      expect(handler).toBeTypeOf("function");

      const response = await handler!({
        req: {
          method: "POST",
          headers: new Headers({
            authorization: `Bearer ${signInternalToken(jobId)}`,
          }),
        },
      });

      expect(response.status).toBe(200);
      expect(processor).toHaveBeenCalled();
    }
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
