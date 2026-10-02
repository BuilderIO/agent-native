import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { designChangeResource } from "./design-change-resource.js";

describe("design-mutating actions", () => {
  it.each([
    "update-design",
    "create-file",
    "delete-file",
    "rename-screen",
    "add-breakpoint",
    "remove-breakpoint",
    "add-localhost-screens",
    "update-screen-source",
    "update-visual-edit-collaboration",
  ])("%s announces its change to collaborators", (name) => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "..", "actions", `${name}.ts`),
      "utf8",
    );
    expect(source).toMatch(/changeResource: .*designChangeResource\(/);
  });
});

describe("designChangeResource", () => {
  it("scopes the change to the design so collaborators, not just the caller, are notified", () => {
    expect(designChangeResource("d1", { changed: true })).toEqual({
      resourceType: "design",
      resourceId: "d1",
    });
  });

  it("notifies for a result that does not report on whether anything changed", () => {
    expect(designChangeResource("d1", undefined)).toEqual({
      resourceType: "design",
      resourceId: "d1",
    });
    expect(designChangeResource("d1", "ok")).toEqual({
      resourceType: "design",
      resourceId: "d1",
    });
  });

  it("names no resource when the design is unknown", () => {
    expect(designChangeResource(undefined, { deleted: true })).toBeNull();
    expect(designChangeResource("", { deleted: true })).toBeNull();
  });

  it.each([
    { stale: true },
    { changed: false },
    { deleted: false },
    { renamed: false },
  ])("stays quiet when the action reports nothing changed (%o)", (result) => {
    expect(designChangeResource("d1", result)).toBeNull();
  });
});
