import { describe, expect, it } from "vitest";

import { functionsDirOf, withPathDefaults } from "./netlify-deploy.js";

describe("netlify-deploy argument handling", () => {
  it("uses the full default publish with no args", () => {
    expect(withPathDefaults([])).toEqual([
      "--prod",
      "--dir=dist",
      "--functions=.netlify/functions-internal",
    ]);
  });

  it("fills only missing path defaults", () => {
    expect(withPathDefaults(["--message", "hotfix"])).toEqual([
      "--message",
      "hotfix",
      "--dir=dist",
      "--functions=.netlify/functions-internal",
    ]);
  });

  it("treats -d and -f as supplied, so defaults never override them", () => {
    expect(withPathDefaults(["-d", "build", "-f", "custom"])).toEqual([
      "-d",
      "build",
      "-f",
      "custom",
    ]);
    expect(functionsDirOf(["-d", "build", "-f", "custom"])).toBe("custom");
    expect(functionsDirOf(["--functions=a/b"])).toBe("a/b");
    expect(functionsDirOf(["--functions", "c"])).toBe("c");
    expect(functionsDirOf([])).toBe(".netlify/functions-internal");
  });
});
