import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getAppConfig, resetAppConfigForTests } from "./store.js";

const originalEnv = { ...process.env };

describe("integrations config: Slack user install", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    delete process.env.SLACK_INTERNAL_TEAM_IDS;
    delete process.env.SLACK_USER_INSTALL_BOOTSTRAP;
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("refuses user-only installs until a deployment opts in", () => {
    const integrations = getAppConfig().integrations;
    expect(integrations.slackInternalTeamIds).toBeUndefined();
    expect(integrations.slackUserInstallBootstrap).toBe(false);
  });

  it("reads the allow-list and bootstrap aliases as typed values", () => {
    process.env.SLACK_INTERNAL_TEAM_IDS = "T0000001,T0000002";
    process.env.SLACK_USER_INSTALL_BOOTSTRAP = "true";
    const integrations = getAppConfig().integrations;
    expect(integrations.slackInternalTeamIds).toEqual(["T0000001", "T0000002"]);
    expect(integrations.slackUserInstallBootstrap).toBe(true);
  });
});
