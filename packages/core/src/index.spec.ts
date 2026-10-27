import { describe, expect, it } from "vitest";

import * as actionCaller from "./action-caller.js";
import * as core from "./index.js";

describe("core export surface", () => {
  it("re-exports the outside-agent check that app approval gates use", () => {
    expect(core.isOutsideAgentCall).toBe(actionCaller.isOutsideAgentCall);
  });
});
