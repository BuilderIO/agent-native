import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runDueMonitorsOnce = vi.hoisted(() => vi.fn());

vi.mock("../jobs/uptime-monitors", () => ({
  runDueMonitorsOnce,
}));

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.NETLIFY;
  delete process.env.NETLIFY_FUNCTION_NAME;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.LAMBDA_TASK_ROOT;
  delete process.env.AWS_EXECUTION_ENV;
  delete process.env.VERCEL;
  delete process.env.UPTIME_MONITOR_JOBS;
  delete process.env.RUN_BACKGROUND_JOBS;
  delete process.env.UPTIME_MONITOR_INTERVAL_MS;
  globalThis.__AGENT_NATIVE_UPTIME_MONITOR_SCHEDULED_RUNTIME__ = undefined;
}

async function loadRegister() {
  vi.resetModules();
  return (await import("./uptime-monitor-jobs")).default;
}

describe("uptime monitor job registration", () => {
  let intervalSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetEnv();
    runDueMonitorsOnce.mockReset();
    intervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(() => 1 as unknown as NodeJS.Timeout);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  it("skips in-process sweeps in production Lambda runtimes even when enabled", async () => {
    process.env.NODE_ENV = "production";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "analytics-handler";
    process.env.UPTIME_MONITOR_JOBS = "1";

    const register = await loadRegister();
    register();

    expect(intervalSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("production serverless runtimes"),
    );
  });

  it("skips in-process sweeps when the generated scheduled worker is running", async () => {
    process.env.NODE_ENV = "production";
    globalThis.__AGENT_NATIVE_UPTIME_MONITOR_SCHEDULED_RUNTIME__ = true;

    const register = await loadRegister();
    register();

    expect(intervalSpy).not.toHaveBeenCalled();
  });

  it("keeps in-process sweeps enabled by default for long-lived production runtimes", async () => {
    process.env.NODE_ENV = "production";

    const register = await loadRegister();
    register();

    expect(intervalSpy).toHaveBeenCalledTimes(1);
  });
});
