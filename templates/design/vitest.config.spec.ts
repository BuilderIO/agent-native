import { describe, expect, it } from "vitest";

import vitestConfig from "./vitest.config";
import performanceConfig from "./vitest.perf.config";

describe("Design Vitest config", () => {
  it("excludes performance specs from the default test suite", () => {
    expect(vitestConfig.test?.include).toContain(
      "**/*.{test,spec}.?(c|m)[jt]s?(x)",
    );
    expect(vitestConfig.test?.exclude).toContain("**/*.perf.spec.ts");
  });

  it("includes performance specs in the isolated test config", () => {
    expect(performanceConfig.test?.include).toEqual(["**/*.perf.spec.ts"]);
    expect(performanceConfig.test?.exclude).not.toContain("**/*.perf.spec.ts");
  });
});
