import { describe, expect, it } from "vitest";

import { normalizeHttpTelemetryPath } from "./http-response-telemetry.js";

describe("http response telemetry", () => {
  it("normalizes high-cardinality path segments before tracking", () => {
    expect(
      normalizeHttpTelemetryPath(
        "/design/_agent-native/agent-chat/runs/run-1783002639448-8rptjt/events",
      ),
    ).toBe("/design/_agent-native/agent-chat/runs/:id/events");
    expect(
      normalizeHttpTelemetryPath(
        "/api/session-replay/recordings/2f6d6628-b9fa-4c09-8cef-306928123456",
      ),
    ).toBe("/api/session-replay/recordings/:id");
  });
});
