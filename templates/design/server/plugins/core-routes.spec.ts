import { describe, expect, it } from "vitest";

import { resolveDesignOpenPath } from "./core-routes.js";

describe("resolveDesignOpenPath", () => {
  it("resolves a bare design id to the editor route", () => {
    expect(
      resolveDesignOpenPath({ view: "editor", params: { designId: "d1" } }),
    ).toBe("/design/d1");
  });

  it("resolves a design id with a screen to the overview canvas focused on it", () => {
    expect(
      resolveDesignOpenPath({
        view: "editor",
        params: { designId: "d1", screen: "file-1" },
      }),
    ).toBe("/design/d1?view=overview&screen=file-1");
  });

  it("falls back to /home for an editor view with no design id", () => {
    expect(resolveDesignOpenPath({ view: "editor", params: {} })).toBe("/home");
  });

  it("returns null for an unrecognized view with no design id", () => {
    expect(resolveDesignOpenPath({ view: "templates", params: {} })).toBeNull();
  });
});
