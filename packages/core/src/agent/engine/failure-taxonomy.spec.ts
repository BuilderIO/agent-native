import { describe, expect, it } from "vitest";

import { classifyAgentFailure } from "./failure-taxonomy.js";

describe("classifyAgentFailure", () => {
  it("classifies the four measured interactive failure families", () => {
    expect(
      classifyAgentFailure({
        runId: "run-tls",
        errorDetail: "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR",
      }),
    ).toMatchObject({
      code: "provider_network_error",
      label: "SSL/TLS provider transport drop",
      regime: "interactive",
      source: "error_detail",
    });
    expect(
      classifyAgentFailure({
        runId: "run-config",
        errorDetail:
          "Function tools with reasoning_effort are not supported for gpt-5.6.",
      }).code,
    ).toBe("provider_config_error");
    expect(
      classifyAgentFailure({
        runId: "run-overloaded",
        errorDetail: '{"type":"error","error":{"type":"overloaded_error"}}',
      }).code,
    ).toBe("overloaded_error");
    expect(
      classifyAgentFailure({
        runId: "run-auth",
        errorDetail: "Missing Authentication header",
      }).code,
    ).toBe("authentication_error");
  });

  it("uses the durable job namespace to separate scheduled runs", () => {
    expect(
      classifyAgentFailure({
        runId: "job-analytics-2026-07-31",
        errorCode: "provider_network_error",
      }),
    ).toMatchObject({
      code: "provider_network_error",
      regime: "scheduled",
      source: "error_code",
    });
  });

  it("reads structured terminal event codes when detail text is absent", () => {
    expect(
      classifyAgentFailure({
        runId: "job-plan-1",
        terminalEvent: {
          type: "error",
          errorCode: "overloaded_error",
        },
      }),
    ).toMatchObject({
      code: "overloaded_error",
      regime: "scheduled",
      source: "error_detail",
    });
  });

  it("does not turn an unknown failure into a confident diagnosis", () => {
    expect(
      classifyAgentFailure({ runId: "run-unknown", errorDetail: "boom" }),
    ).toEqual({
      code: "unknown",
      label: "Unclassified failure",
      regime: "interactive",
      source: "unknown",
    });
  });
});
