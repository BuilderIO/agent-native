import { describe, expect, it } from "vitest";

import { readPackageConfigLayer } from "./package-layer.js";

describe("readPackageConfigLayer", () => {
  // These run from `packages/core`, whose package.json name is not a
  // first-party template — the same shape a serverless bundle produces when
  // `process.cwd()` points at a generated package.json.
  it("emits nothing for a package the template table does not know", () => {
    expect(readPackageConfigLayer()).toEqual({});
  });

  it("is memoized, so the package.json read happens once per process", () => {
    expect(readPackageConfigLayer()).toBe(readPackageConfigLayer());
  });

  it("never emits packageName or template", () => {
    // Both are read as app-id fallbacks in credential-grant lookups. Filling
    // them from package.json where they are currently undefined would repoint
    // those lookups, so the env layer stays their only source.
    const app = (readPackageConfigLayer().app ?? {}) as Record<string, unknown>;
    expect(app.packageName).toBeUndefined();
    expect(app.template).toBeUndefined();
  });
});
