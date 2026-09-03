import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runSessionReplayRetentionOnce = vi.hoisted(() => vi.fn());

vi.mock("../jobs/session-replay-retention", () => ({
  runSessionReplayRetentionOnce,
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
  delete process.env.ANALYTICS_SESSION_REPLAY_RETENTION_JOBS;
  delete process.env.RUN_BACKGROUND_JOBS;
}

async function loadRegister() {
  vi.resetModules();
  return (await import("./session-replay-retention-jobs")).default;
}

describe("session replay retention job registration", () => {
  let intervalSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetEnv();
    runSessionReplayRetentionOnce.mockReset();
    intervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(() => 1 as unknown as NodeJS.Timeout);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    resetEnv();
    vi.restoreAllMocks();
  });

  it("does not start an in-process timer in production serverless", async () => {
    process.env.NODE_ENV = "production";
    process.env.NETLIFY = "true";
    process.env.ANALYTICS_SESSION_REPLAY_RETENTION_JOBS = "1";

    const register = await loadRegister();
    register();

    expect(intervalSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("scheduled/background sweeps"),
    );
  });

  it("keeps the retention timer available to a long-lived production runtime", async () => {
    process.env.NODE_ENV = "production";

    const register = await loadRegister();
    register();

    expect(intervalSpy).toHaveBeenCalledTimes(1);
  });
});
