import { describe, expect, it } from "vitest";

import { CORE_LABS } from "./core-labs.js";

describe("core labs", () => {
  it("keeps the keys people's lab choices are saved under", () => {
    // Renaming a key would drop every saved choice for that lab.
    // oracle-change: the cards lab is deleted, so only the ChatGPT lab is left to check.
    expect(CORE_LABS.map((lab) => lab.key)).toEqual(["chatgpt-subscription"]);
  });
});
