import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dispatchConfig } from "./dispatch.js";
import { getAppConfig, resetAppConfigForTests } from "./store.js";

const originalEnv = { ...process.env };

describe("Dispatch config", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    delete process.env.DISPATCH_DIRECT_APP_ACTIONS;
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("keeps direct app actions off unless a deployment opts in", () => {
    expect(dispatchConfig.parse({}).directAppActions).toBe(false);
    expect(getAppConfig().dispatch.directAppActions).toBe(false);
  });

  it("turns direct app actions on from DISPATCH_DIRECT_APP_ACTIONS", () => {
    process.env.DISPATCH_DIRECT_APP_ACTIONS = "true";
    expect(getAppConfig().dispatch.directAppActions).toBe(true);
  });

  it("rejects a non-boolean direct app actions value", () => {
    expect(() =>
      dispatchConfig.parse({ directAppActions: "sometimes" }),
    ).toThrow();
  });
});
