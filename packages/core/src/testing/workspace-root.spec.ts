import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findWorkspaceRoot } from "../../vitest.workspace-root.js";

const fixtures: string[] = [];

function fixture(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "core-workspace-root-"));
  fixtures.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    rmSync(directory, { recursive: true });
  }
});

describe("Core test workspace discovery", () => {
  it.each(["packages/core", "packages/core/.stryker-tmp/sandbox-copy"])(
    "finds the real workspace from %s without requiring copied templates",
    (relativeDirectory) => {
      const workspace = fixture();
      writeFileSync(
        path.join(workspace, "pnpm-workspace.yaml"),
        "packages: []\n",
      );
      const start = path.join(workspace, relativeDirectory);
      mkdirSync(start, { recursive: true });

      expect(findWorkspaceRoot(start)).toBe(workspace);
    },
  );

  it("refuses a directory that has no workspace ancestor", () => {
    expect(() => findWorkspaceRoot(fixture())).toThrow(
      "Could not find pnpm-workspace.yaml",
    );
  });
});
