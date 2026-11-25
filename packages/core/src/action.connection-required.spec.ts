import { describe, expect, it } from "vitest";

import { AgentConnectionRequiredError } from "./action.js";

describe("AgentConnectionRequiredError connectUrl", () => {
  it("preserves optional connectUrl when provided and leaves it undefined when omitted", () => {
    const withUrl = new AgentConnectionRequiredError(
      "Connect Google Calendar to continue.",
      {
        provider: "google_calendar",
        connectUrl: "/_agent-native/google/auth-url?redirect=1&calendar=1",
      },
    );
    expect(withUrl.connectUrl).toBe(
      "/_agent-native/google/auth-url?redirect=1&calendar=1",
    );

    const withoutUrl = new AgentConnectionRequiredError(
      "Connect Google Calendar to continue.",
      {
        provider: "google_calendar",
      },
    );
    expect(withoutUrl.connectUrl).toBeUndefined();
  });
});
