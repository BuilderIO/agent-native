import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { AgentNativeMotionText } from "@agent-native/core/client/motion-text";
import { describe, expect, it } from "vitest";

describe("published React Motion Text entry", () => {
  it("resolves the built component and its exported stylesheet", () => {
    const componentPath = fileURLToPath(
      import.meta.resolve("@agent-native/core/client/motion-text"),
    );
    const stylesheetPath = fileURLToPath(
      import.meta.resolve("@agent-native/core/client/motion-text.css"),
    );

    expect(AgentNativeMotionText).toBeTypeOf("function");
    expect(componentPath).toMatch(/dist\/client\/motion-text\.js$/u);
    expect(existsSync(componentPath)).toBe(true);
    expect(stylesheetPath).toMatch(/dist\/client\/motion-text\.css$/u);
    expect(existsSync(stylesheetPath)).toBe(true);
  });
});
