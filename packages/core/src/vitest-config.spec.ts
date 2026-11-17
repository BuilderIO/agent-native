import { describe, expect, it } from "vitest";

import vitestBaseConfig from "./vitest-config.js";

describe("vitest base config", () => {
  it("turns the Node webstorage global off only where the runtime knows the flag", () => {
    const flag = "--no-experimental-webstorage";
    const expected = process.allowedNodeEnvironmentFlags.has(flag)
      ? [flag]
      : [];

    expect(vitestBaseConfig.test?.execArgv).toEqual(expected);
  });
});
