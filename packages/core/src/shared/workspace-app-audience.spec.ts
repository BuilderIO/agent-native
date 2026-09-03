import { describe, expect, it } from "vitest";

import {
  normalizeWorkspaceAppPathList,
  workspaceAppRouteAccessFromPackageJson,
} from "./workspace-app-audience.js";

describe("workspaceAppRouteAccessFromPackageJson", () => {
  it("returns undefined fields when keys are absent", () => {
    expect(
      workspaceAppRouteAccessFromPackageJson({
        name: "demo",
        "agent-native": {},
      }),
    ).toEqual({});
  });

  it("distinguishes explicitly empty array from missing field", () => {
    const result = workspaceAppRouteAccessFromPackageJson({
      "agent-native": { workspaceApp: { publicPaths: [] } },
    });
    expect(result.publicPaths).toEqual([]);
    expect(result.protectedPaths).toBeUndefined();
  });

  it("ignores garbage scalar types so typos don't silently clear overrides", () => {
    // false / 0 / {} all normalize to [] inside normalizeWorkspaceAppPathList;
    // the guard must reject them before they become "explicitly empty".
    for (const bad of [false, 0, {}, true]) {
      expect(
        workspaceAppRouteAccessFromPackageJson({
          "agent-native": { workspaceApp: { publicPaths: bad } },
        }),
      ).toEqual({});
    }
  });

  it("accepts string paths (parsed as JSON or comma-separated)", () => {
    expect(
      workspaceAppRouteAccessFromPackageJson({
        "agent-native": {
          workspaceApp: { publicPaths: '["/share","/embed"]' },
        },
      }),
    ).toEqual({ publicPaths: ["/share", "/embed"] });
    expect(
      workspaceAppRouteAccessFromPackageJson({
        "agent-native": { workspaceApp: { publicPaths: "/api,/share" } },
      }),
    ).toEqual({ publicPaths: ["/api", "/share"] });
  });

  it("treats null as absent (falls through the alias `??` chain)", () => {
    // The alias resolution uses `??`, so null doesn't short-circuit. To
    // clear an inherited override, use an empty array.
    expect(
      workspaceAppRouteAccessFromPackageJson({
        "agent-native": { workspaceApp: { publicPaths: null } },
      }),
    ).toEqual({});
  });
});

describe("normalizeWorkspaceAppPathList", () => {
  it("preserves JSON-parsed scalar path", () => {
    expect(normalizeWorkspaceAppPathList('"/api"')).toEqual(["/api"]);
  });

  it("filters and dedupes entries that don't start with /", () => {
    expect(normalizeWorkspaceAppPathList(["/a", "/a", "no-slash", ""])).toEqual(
      ["/a"],
    );
  });

  it("strips trailing slash but keeps the root slash", () => {
    expect(normalizeWorkspaceAppPathList(["/foo/"])).toEqual(["/foo"]);
  });
});
