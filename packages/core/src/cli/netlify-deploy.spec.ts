import { describe, expect, it } from "vitest";

import {
  assertStatusOutputEnabled,
  functionsDirOf,
  withPathDefaults,
} from "./netlify-deploy.js";

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

describe("netlify-deploy argument validation", () => {
  it("rejects repeated or empty functions flags", () => {
    expect(() => functionsDirOf(["-f", "a", "--functions=b"])).toThrow(
      /more than once/,
    );
    expect(() => withPathDefaults(["--dir="])).toThrow(/needs a directory/);
  });
});

describe("netlify-deploy status output", () => {
  it("refuses flags that hide the manifest-discard marker", () => {
    expect(() => assertStatusOutputEnabled(["--json"])).toThrow(
      /hides the CLI status line/,
    );
    expect(() => assertStatusOutputEnabled(["--silent"])).toThrow(
      /hides the CLI status line/,
    );
    expect(() => assertStatusOutputEnabled(["--prod"])).not.toThrow();
  });
});
