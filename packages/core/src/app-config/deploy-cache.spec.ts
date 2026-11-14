import { afterEach, describe, expect, it, vi } from "vitest";

import { deployCacheConfig } from "./deploy-cache.js";
import { getAppConfig, resetAppConfigForTests } from "./index.js";

afterEach(() => {
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

describe("deploy cache config", () => {
  it("enables reuse without verification or ignored environment inputs by default", () => {
    expect(deployCacheConfig.parse({})).toEqual({
      enabled: true,
      verifySample: 0,
      envIgnore: [],
    });
  });

  it("resolves the documented environment switches through app config", () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOY_CACHE", "false");
    vi.stubEnv("AGENT_NATIVE_DEPLOY_CACHE_DIR", "/tmp/workspace-build-cache");
    vi.stubEnv("AGENT_NATIVE_DEPLOY_CACHE_VERIFY", "2");
    vi.stubEnv("AGENT_NATIVE_DEPLOY_CACHE_ENV_IGNORE", "CI_JOB_ID,TRACE_*");
    resetAppConfigForTests();

    expect(getAppConfig().deployCache).toEqual({
      enabled: false,
      dir: "/tmp/workspace-build-cache",
      verifySample: 2,
      envIgnore: ["CI_JOB_ID", "TRACE_*"],
    });
  });

  it.each([
    { enabled: "false" },
    { dir: "" },
    { verifySample: -1 },
    { verifySample: 0.5 },
    { envIgnore: [""] },
  ])("rejects invalid configuration %j", (input) => {
    expect(deployCacheConfig.safeParse(input).success).toBe(false);
  });
});
