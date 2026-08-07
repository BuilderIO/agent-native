import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runAnalyticsRollupBackfillOnce = vi.hoisted(() => vi.fn());

vi.mock("../jobs/analytics-rollup-backfill", () => ({
  runAnalyticsRollupBackfillOnce,
}));

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.NETLIFY;
  delete process.env.NETLIFY_FUNCTION_NAME;
  delete process.env.NITRO_PRESET;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.LAMBDA_TASK_ROOT;
  delete process.env.AWS_EXECUTION_ENV;
  delete process.env.CF_PAGES;
  delete process.env.VERCEL;
  delete process.env.ANALYTICS_ROLLUP_BACKFILL_JOBS;
  delete process.env.RUN_BACKGROUND_JOBS;
  delete process.env.ANALYTICS_ROLLUP_BACKFILL_INTERVAL_MS;
  globalThis.__AGENT_NATIVE_ANALYTICS_ROLLUP_BACKFILL_SCHEDULED_RUNTIME__ =
    undefined;
}

async function loadRegister() {
  vi.resetModules();
  return (await import("./analytics-rollup-backfill-jobs")).default;
}

describe("analytics rollup backfill job registration", () => {
  let intervalSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetEnv();
    runAnalyticsRollupBackfillOnce.mockReset();
    intervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(() => 1 as unknown as NodeJS.Timeout);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  it("uses the generated Netlify scheduler instead of an interval", async () => {
    process.env.NODE_ENV = "production";
    process.env.NETLIFY = "true";
    process.env.ANALYTICS_ROLLUP_BACKFILL_JOBS = "1";

    const register = await loadRegister();
    register();

    expect(intervalSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("platform scheduler owns"),
    );
  });

  it("uses the generated Netlify scheduler when Nitro selects the Netlify preset", async () => {
    process.env.NODE_ENV = "production";
    process.env.NITRO_PRESET = "netlify";

    const register = await loadRegister();
    register();

    expect(intervalSpy).not.toHaveBeenCalled();
  });

  it("keeps the interval enabled in production Lambda runtimes without a scheduler", async () => {
    process.env.NODE_ENV = "production";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "analytics-handler";

    const register = await loadRegister();
    register();

    expect(intervalSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the interval enabled in production Vercel runtimes without a scheduler", async () => {
    process.env.NODE_ENV = "production";
    process.env.VERCEL = "1";

    const register = await loadRegister();
    register();

    expect(intervalSpy).toHaveBeenCalledTimes(1);
  });

  it("uses the generated scheduled worker when its runtime marker is set", async () => {
    process.env.NODE_ENV = "production";
    globalThis.__AGENT_NATIVE_ANALYTICS_ROLLUP_BACKFILL_SCHEDULED_RUNTIME__ = true;

    const register = await loadRegister();
    register();

    expect(intervalSpy).not.toHaveBeenCalled();
  });

  it("keeps intervals enabled for long-lived production servers", async () => {
    process.env.NODE_ENV = "production";

    const register = await loadRegister();
    register();

    expect(intervalSpy).toHaveBeenCalledTimes(1);
  });
});
