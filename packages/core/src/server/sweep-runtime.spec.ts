import { describe, expect, it } from "vitest";

import { shouldDisableInProcessSweeps } from "./sweep-runtime.js";

describe("shouldDisableInProcessSweeps", () => {
  it("is OFF by default, so recovery keeps working where the timers are the only driver", () => {
    expect(shouldDisableInProcessSweeps({})).toBe(false);
    expect(
      shouldDisableInProcessSweeps({
        AGENT_NATIVE_DISABLE_INPROCESS_SWEEPS: undefined,
      }),
    ).toBe(false);
    expect(
      shouldDisableInProcessSweeps({
        AGENT_NATIVE_DISABLE_INPROCESS_SWEEPS: "",
      }),
    ).toBe(false);
  });

  it("accepts the same truthy spellings as the sibling runtime switches", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on", " on "]) {
      expect(
        shouldDisableInProcessSweeps({
          AGENT_NATIVE_DISABLE_INPROCESS_SWEEPS: value,
        }),
      ).toBe(true);
    }
  });

  it("does not treat an arbitrary value as opt-in", () => {
    // "0"/"false" must not disable sweeps — a deployment that sets the variable
    // to an off-value is asking for the default, not for silent breakage.
    for (const value of ["0", "false", "off", "no", "maybe"]) {
      expect(
        shouldDisableInProcessSweeps({
          AGENT_NATIVE_DISABLE_INPROCESS_SWEEPS: value,
        }),
      ).toBe(false);
    }
  });

  it("disables in-process sweeps automatically in production functions", () => {
    expect(
      shouldDisableInProcessSweeps({
        NODE_ENV: "production",
        NETLIFY_FUNCTION_NAME: "analytics",
      }),
    ).toBe(true);
    expect(
      shouldDisableInProcessSweeps({
        NODE_ENV: "production",
        AWS_LAMBDA_FUNCTION_VERSION: "1",
      }),
    ).toBe(true);
  });

  it("keeps local Netlify emulation eligible for its recovery timers", () => {
    expect(
      shouldDisableInProcessSweeps({
        NODE_ENV: "production",
        NETLIFY_FUNCTION_NAME: "analytics",
        NETLIFY_LOCAL: "true",
      }),
    ).toBe(false);
  });
});
