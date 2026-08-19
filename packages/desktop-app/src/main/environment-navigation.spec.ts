import { describe, expect, it } from "vitest";

import { isAllowedEnvironmentNavigation } from "./environment-navigation";

describe("isAllowedEnvironmentNavigation", () => {
  it("keeps an Agent Native beta/prod switch in the webview", () => {
    expect(
      isAllowedEnvironmentNavigation(
        new URL("https://plan.agent-native.com/inbox"),
        new URL("https://beta.plan.agent-native.com/inbox"),
      ),
    ).toBe(true);
    expect(
      isAllowedEnvironmentNavigation(
        new URL("https://beta.agent-workspace.builder.io/"),
        new URL("https://agent-workspace.builder.io/"),
      ),
    ).toBe(true);
    expect(
      isAllowedEnvironmentNavigation(
        new URL("https://chat.agent-native.com/"),
        new URL("https://beta.chat.agent-native.com/"),
      ),
    ).toBe(true);
  });

  it("does not turn arbitrary cross-origin links into internal navigation", () => {
    expect(
      isAllowedEnvironmentNavigation(
        new URL("https://plan.agent-native.com/inbox"),
        new URL("https://example.com/inbox"),
      ),
    ).toBe(false);
    expect(
      isAllowedEnvironmentNavigation(
        new URL("https://plan.agent-native.com/inbox"),
        new URL("http://beta.plan.agent-native.com/inbox"),
      ),
    ).toBe(false);
    expect(
      isAllowedEnvironmentNavigation(
        new URL("https://plan.agent-native.com:8443/inbox"),
        new URL("https://beta.plan.agent-native.com/inbox"),
      ),
    ).toBe(false);
    expect(
      isAllowedEnvironmentNavigation(
        new URL("https://starter.agent-native.com/"),
        new URL("https://beta.starter.agent-native.com/"),
      ),
    ).toBe(false);
  });
});
