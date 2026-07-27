import { describe, expect, it } from "vitest";

import {
  designConnectionIdFromData,
  designSourceTypeFromData,
  makeLocalhostRouteId,
  normalizeDesignSourceType,
  parseDataLocProvenance,
  titleFromRoutePath,
} from "./source-mode";

describe("source mode helpers", () => {
  it("normalizes legacy source names into the three design source modes", () => {
    expect(normalizeDesignSourceType("design-file")).toBe("inline");
    expect(normalizeDesignSourceType("inline-html")).toBe("inline");
    expect(normalizeDesignSourceType("local-file")).toBe("localhost");
    expect(normalizeDesignSourceType("dev-server")).toBe("localhost");
    expect(normalizeDesignSourceType("remote-url")).toBe("fusion");
    expect(normalizeDesignSourceType("fusion")).toBe("fusion");
    expect(normalizeDesignSourceType("unknown")).toBeNull();
  });

  it("resolves canonical and legacy design data source fields", () => {
    expect(designSourceTypeFromData('{"sourceType":"localhost"}')).toBe(
      "localhost",
    );
    expect(designSourceTypeFromData({ sourceMode: "localhost" })).toBe(
      "localhost",
    );
    expect(
      designSourceTypeFromData({
        sourceType: "fusion",
        sourceMode: "localhost",
      }),
    ).toBe("fusion");
    expect(designSourceTypeFromData("not-json")).toBe("inline");
  });

  it("recovers localhost connection ids from canonical and legacy metadata", () => {
    expect(designConnectionIdFromData({ connectionId: "top-level" })).toBe(
      "top-level",
    );
    expect(
      designConnectionIdFromData({
        screenMetadata: { screen: { connectionId: "canonical" } },
      }),
    ).toBe("canonical");
    expect(
      designConnectionIdFromData(
        JSON.stringify({
          localhostScreens: { screen: { connectionId: "legacy" } },
        }),
      ),
    ).toBe("legacy");
    expect(designConnectionIdFromData("not-json")).toBeUndefined();
  });

  it("creates stable ids and titles for localhost route artboards", () => {
    expect(makeLocalhostRouteId("/")).toMatch(/^route-root-[a-z0-9]+$/);
    expect(makeLocalhostRouteId("/settings/profile")).toMatch(
      /^route-settings-profile-[a-z0-9]+$/,
    );
    expect(makeLocalhostRouteId("/design/:id")).toMatch(
      /^route-design-pid-[a-z0-9]+$/,
    );
    // Param routes and plausible literal equivalents must NOT collide:
    expect(makeLocalhostRouteId("/design-id")).toMatch(
      /^route-design-id-[a-z0-9]+$/,
    );
    expect(makeLocalhostRouteId("/design/pid")).toMatch(
      /^route-design-pid-[a-z0-9]+$/,
    );
    expect(makeLocalhostRouteId("/design/:id")).not.toBe(
      makeLocalhostRouteId("/design/pid"),
    );
    // Wildcard catch-alls stay distinct from their base path:
    expect(makeLocalhostRouteId("/users")).toMatch(/^route-users-[a-z0-9]+$/);
    expect(makeLocalhostRouteId("/users/*")).toMatch(
      /^route-users-w-[a-z0-9]+$/,
    );
    expect(makeLocalhostRouteId("/users/*")).not.toBe(
      makeLocalhostRouteId("/users/w"),
    );
    expect(makeLocalhostRouteId("/*")).toMatch(/^route-wildcard-[a-z0-9]+$/);
    for (const [left, right] of [
      ["/", "/root"],
      ["/*", "/wildcard"],
      ["/foo/bar", "/foo-bar"],
      ["/foo-bar", "/foo_bar"],
      ["/search?q=one", "/search?q=two"],
    ]) {
      expect(makeLocalhostRouteId(left)).not.toBe(makeLocalhostRouteId(right));
    }
    expect(titleFromRoutePath("/design/:id")).toBe("Design Id");
    expect(titleFromRoutePath("/*")).toBe("Wildcard");
  });

  it("parses data-loc provenance from the right so Windows paths survive", () => {
    expect(parseDataLocProvenance("C:/src/App.tsx:12:3")).toEqual({
      sourceFile: "C:/src/App.tsx",
      line: 12,
      column: 3,
    });
    expect(parseDataLocProvenance("/src/App.tsx:12")).toEqual({
      sourceFile: "/src/App.tsx",
      line: 12,
      column: undefined,
    });
    expect(parseDataLocProvenance("not-a-location")).toBeNull();
  });
});
