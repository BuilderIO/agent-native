import { describe, expect, it } from "vitest";

import { defineAction } from "../action.js";
import { isOutsideAutomationOrigin } from "./index.js";

describe("automation origin through the public trigger API", () => {
  it.each(["mcp", "a2a"] as const)(
    "retains a %s ancestor through a trusted inner context",
    async (networkProtocol) => {
      const outer = defineAction({
        run: () => isOutsideAutomationOrigin({ caller: "frontend" }),
      });
      await expect(
        outer.run({}, { caller: "tool", networkProtocol }),
      ).resolves.toBe(true);
      await expect(outer.run({}, { caller: "tool" })).resolves.toBe(false);
    },
  );
});
