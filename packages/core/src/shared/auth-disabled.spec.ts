import { describe, expect, it } from "vitest";

import { isAuthDisabled } from "./auth-disabled.js";
import { getRuntimeConfigReport } from "./runtime-config.js";

describe("isAuthDisabled", () => {
  it.each([
    ["1", true],
    ["true", true],
    ["TRUE ", true],
    ["yes", false],
    ["on", false],
    ["0", false],
    ["false", false],
    ["", false],
    [undefined, false],
  ])("AUTH_DISABLED=%j is %s", (value, expected) => {
    expect(isAuthDisabled({ AUTH_DISABLED: value })).toBe(expected);
  });

  it.each(["1", "true", "TRUE ", "yes", "on", "0"])(
    "agrees with the production config report for AUTH_DISABLED=%j",
    (value) => {
      const env = { NODE_ENV: "production", AUTH_DISABLED: value };
      const reported = getRuntimeConfigReport(env)
        .issues.map((issue) => issue.code)
        .includes("auth-disabled-in-production");
      expect(reported).toBe(isAuthDisabled(env));
    },
  );
});
