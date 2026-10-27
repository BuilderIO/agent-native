import { describe, expect, it } from "vitest";

import * as actionCaller from "./action-caller.js";
import * as browser from "./index.browser.js";
import * as core from "./index.js";

describe("core export surface", () => {
  it("re-exports the outside-agent check that app approval gates use", () => {
    expect(core.isOutsideAgentCall).toBe(actionCaller.isOutsideAgentCall);
  });

  it("re-exports the outside-agent check from the browser entry too", () => {
    expect(browser.isOutsideAgentCall).toBe(actionCaller.isOutsideAgentCall);
  });
});
