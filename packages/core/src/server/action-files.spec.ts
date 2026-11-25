import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { actionNameFromRelPath, scanActionDir } from "./action-files.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeActions(files: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "action-files-"));
  tmpDirs.push(dir);
  for (const file of files) {
    const full = path.join(dir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "export default {};");
  }
  return dir;
}

describe("actionNameFromRelPath", () => {
  it("joins path segments with a hyphen and drops the extension", () => {
    expect(actionNameFromRelPath("list-meals.ts")).toBe("list-meals");
    expect(actionNameFromRelPath("billing/create-invoice.ts")).toBe(
      "billing-create-invoice",
    );
    expect(actionNameFromRelPath("a\\b\\c.js")).toBe("a-b-c");
  });
});

describe("scanActionDir", () => {
  it("lists nested action files with their derived names", () => {
    const dir = makeActions(["ping.ts", "billing/create-invoice.ts"]);
    const found = scanActionDir(dir, new Set());
    expect(found.map((f) => [f.relPath, f.name]).sort()).toEqual([
      ["billing/create-invoice.ts", "billing-create-invoice"],
      ["ping.ts", "ping"],
    ]);
  });

  it("skips helpers, declarations, tests, non-source files and hidden folders", () => {
    const dir = makeActions([
      "_helper.ts",
      "_shared/inner.ts",
      ".hidden/inner.ts",
      "node_modules/pkg/index.ts",
      "types.d.ts",
      "real.spec.ts",
      "real.test.js",
      "notes.md",
      "kept.js",
    ]);
    expect(scanActionDir(dir, new Set()).map((f) => f.name)).toEqual(["kept"]);
  });

  it("applies the skip list to top-level names only", () => {
    const dir = makeActions(["helpers.ts", "billing/helpers.ts"]);
    expect(scanActionDir(dir, new Set(["helpers"])).map((f) => f.name)).toEqual(
      ["billing-helpers"],
    );
  });

  it("throws, marked as a definition error, when two files share a name", () => {
    const dir = makeActions([
      "billing-create-invoice.ts",
      "billing/create-invoice.ts",
    ]);
    let caught: unknown;
    try {
      scanActionDir(dir, new Set());
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      actionDefinitionError: true,
      message: expect.stringContaining('"billing-create-invoice"'),
    });
  });

  it("returns nothing for a missing directory", () => {
    expect(scanActionDir("/nonexistent/actions-dir", new Set())).toEqual([]);
  });
});
