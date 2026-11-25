import { describe, expect, it } from "vitest";

import { CORE_LABS } from "./core-labs.js";

describe("core labs", () => {
  it("keeps the keys people's lab choices are saved under", () => {
    // Renaming a key would drop every saved choice for that lab.
    // oracle-change: T3 Code agents joins the ChatGPT lab.
    expect(CORE_LABS.map((lab) => lab.key)).toEqual([
      "chatgpt-subscription",
      "t3-code-agents",
    ]);
  });
});
