import { describe, expect, it } from "vitest";

import { isHostedHarnessEnvEnabled } from "./hosted-harness-policy.js";

describe("hosted harness environment gate", () => {
  it.each(["1", "true", "yes", "on"])("accepts %s", (value) => {
    expect(
      isHostedHarnessEnvEnabled({ AGENT_NATIVE_HOSTED_HARNESS: value }),
    ).toBe(true);
  });

  it.each([undefined, "0", "false", "off", "no"])(
    "rejects %s",
    (value) => {
      expect(
        isHostedHarnessEnvEnabled({ AGENT_NATIVE_HOSTED_HARNESS: value }),
      ).toBe(false);
    },
  );
});
