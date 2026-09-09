import { describe, expect, it } from "vitest";

import { resolveEnabledAutomations } from "./factory-automation-plan.js";

describe("resolveEnabledAutomations", () => {
  it("turns on Slack polling without naming automations to enable", () => {
    expect(
      resolveEnabledAutomations({
        observeSlack: true,
        slackChannelId: "C123",
        observeGithub: false,
        observeSentry: false,
      }),
    ).toEqual({
      pollingEnabled: true,
      githubPollingEnabled: false,
      sentryPollingEnabled: false,
      hasConfig: true,
    });
  });

  it("turns on GitHub polling from a repository without enabling PR jobs", () => {
    expect(
      resolveEnabledAutomations({
        observeSlack: false,
        observeGithub: true,
        repository: "BuilderIO/agent-native",
        observeSentry: false,
      }),
    ).toEqual({
      pollingEnabled: false,
      githubPollingEnabled: true,
      sentryPollingEnabled: false,
      hasConfig: true,
    });
  });

  it("stores a repository without treating it as GitHub polling", () => {
    expect(
      resolveEnabledAutomations({
        observeSlack: false,
        observeGithub: false,
        repository: "BuilderIO/agent-native",
        observeSentry: false,
      }),
    ).toEqual({
      pollingEnabled: false,
      githubPollingEnabled: false,
      sentryPollingEnabled: false,
      hasConfig: true,
    });
  });
});
