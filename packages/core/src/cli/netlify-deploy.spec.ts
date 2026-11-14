import { describe, expect, it } from "vitest";

import {
  assertStatusOutputEnabled,
  createManifestWatcher,
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

  it("pins only the functions dir when args are given", () => {
    expect(withPathDefaults(["--message", "hotfix"])).toEqual([
      "--message",
      "hotfix",
      "--functions=.netlify/functions-internal",
    ]);
    expect(withPathDefaults(["-d", "build", "-f", "custom"])).toEqual([
      "-d",
      "build",
      "-f",
      "custom",
    ]);
  });

  it("reads the functions dir from any supported form", () => {
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
    expect(() => assertStatusOutputEnabled(["--skip-functions-cache"])).toThrow(
      /ignore the deterministic functions manifest/,
    );
    expect(() => assertStatusOutputEnabled(["--config", "x.toml"])).toThrow(
      /--config/,
    );
    expect(() => assertStatusOutputEnabled(["-c=x.toml"])).toThrow(/--config/);
    expect(() => assertStatusOutputEnabled(["-cx.toml"])).toThrow(/--config/);
    for (const grouped of ["-fcustom", "-f=other", "-pf"]) {
      expect(() => assertStatusOutputEnabled([grouped, "x"])).toThrow(
        /short option/,
      );
    }
    expect(() =>
      assertStatusOutputEnabled(["-p", "-f", "dir", "--prod"]),
    ).not.toThrow();
  });
});

describe("createManifestWatcher", () => {
  it("finds a marker followed by lots of trailing output in one chunk", () => {
    let stopped = 0;
    const watcher = createManifestWatcher(() => stopped++);
    watcher.push(
      `Ignored invalid or expired functions cache\n${"x".repeat(500)}`,
    );
    expect(watcher.rejected).toMatch(/^Ignored/);
    expect(stopped).toBe(1);
  });

  it("finds a marker split across chunks and a confirmation", () => {
    const watcher = createManifestWatcher(() => {});
    watcher.push("Deploying functions fr");
    watcher.push("om cache (use --skip-functions-cache to override)\nmore");
    expect(watcher.consumed).toBe(true);
    expect(watcher.rejected).toBeUndefined();
  });
});
