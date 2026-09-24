import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanResourceActionAccess } from "./resource-action-access.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function rootWithAction(source: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-action-access-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "actions"), { recursive: true });
  fs.writeFileSync(path.join(root, "actions", "update.ts"), source);
  return root;
}

function rootWithNestedAction(source: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-action-access-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "actions", "forms"), { recursive: true });
  fs.writeFileSync(path.join(root, "actions", "forms", "update.ts"), source);
  return root;
}

describe("scanResourceActionAccess", () => {
  it("warns on a resource hint without access enforcement", () => {
    const result = scanResourceActionAccess({
      root: rootWithAction(
        'export default defineAction({ resourceType: "form" });\n',
      ),
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({
        file: "actions/update.ts",
        line: 1,
      }),
    ]);
    expect(result.findings).toEqual([]);
  });

  it("accepts declarative and imperative guards", () => {
    expect(
      scanResourceActionAccess({
        root: rootWithAction(
          'export default defineAction({ resourceType: "form", access: { scope: "resource", resource: { type: "form", idFrom: "id" } } });\n',
        ),
      }).warnings,
    ).toEqual([]);
    expect(
      scanResourceActionAccess({
        root: rootWithAction(
          'export default defineAction({ resource: { type: "form", idFrom: "id" } });\n',
        ),
      }).warnings,
    ).toEqual([]);
    expect(
      scanResourceActionAccess({
        root: rootWithAction(
          'export default defineAction({ resourceType: "form", run: () => assertAccess("form", "id", "editor") });\n',
        ),
      }).warnings,
    ).toEqual([]);
    expect(
      scanResourceActionAccess({
        root: rootWithAction(
          'export default defineAction({ resourceType: "form", run: () => resolveAccess("form", "id") });\n',
        ),
      }).warnings,
    ).toEqual([]);
    expect(
      scanResourceActionAccess({
        root: rootWithAction(
          'export default defineAction({ resourceType: "form", run: () => accessFilter("form") });\n',
        ),
      }).warnings,
    ).toEqual([]);
  });

  it("scans nested action directories", () => {
    expect(
      scanResourceActionAccess({
        root: rootWithNestedAction(
          'export default defineAction({ resourceType: "form" });\n',
        ),
      }).warnings,
    ).toEqual([expect.objectContaining({ file: "actions/forms/update.ts" })]);
  });
});
