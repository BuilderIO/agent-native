import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAppConfig, resetAppConfigForTests } from "./store.js";

const originalEnv = { ...process.env };

describe("notifications config", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    delete process.env.AGENT_NATIVE_NOTIFICATIONS_USAGE_LIMIT_NOTICES;
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("shows usage-limit notices unless a deployment turns them off", () => {
    expect(getAppConfig().notifications.usageLimitNotices).toBe(true);
  });

  it("reads the deployment alias as a typed boolean", () => {
    process.env.AGENT_NATIVE_NOTIFICATIONS_USAGE_LIMIT_NOTICES = "false";
    expect(getAppConfig().notifications.usageLimitNotices).toBe(false);
  });
});
