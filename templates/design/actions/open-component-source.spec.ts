import { describe, expect, it } from "vitest";

import action from "./open-component-source.js";

describe("open-component-source transport", () => {
  it("uses the default mutation transport because it writes navigation state", () => {
    expect(action.readOnly).not.toBe(true);
    expect(action.http).toBeUndefined();
  });
});
