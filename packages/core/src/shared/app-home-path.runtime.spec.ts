import { describe, expect, it } from "vitest";

import { resolveAppHomePath } from "./app-home-path.js";
const manifest = (homePath: unknown) => ({
  appsJson: JSON.stringify({ apps: [{ id: "personal-app", homePath }] }),
});
describe("workspace home resolution runtime", () => {
  it("prioritizes explicit app configuration over the workspace manifest", () => {
    expect(
      resolveAppHomePath(
        { homePath: " /local ", workspaceId: "personal-app" },
        manifest("/remote"),
      ),
    ).toBe("/local");
  });
  it("refreshes cached mappings when the manifest changes", () => {
    expect(
      resolveAppHomePath({ workspaceId: "personal-app" }, manifest("/first")),
    ).toBe("/first");
    expect(
      resolveAppHomePath({ workspaceId: "personal-app" }, manifest("/second")),
    ).toBe("/second");
    expect(
      resolveAppHomePath(
        { workspaceId: "personal-app" },
        { appsJson: "unreadable" },
      ),
    ).toBe("/home");
    expect(
      resolveAppHomePath({ workspaceId: "unlisted" }, manifest("/second")),
    ).toBe("/home");
  });
  it.each([
    "//outside.example.test",
    "https://outside.example.test",
    "/path?redirect=other",
    "/path\\child",
    "",
  ])("rejects invalid manifest home %s", (homePath) => {
    expect(
      resolveAppHomePath({ workspaceId: "personal-app" }, manifest(homePath)),
    ).toBe("/home");
  });
});
