import { describe, expect, it } from "vitest";

import {
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

  it("creates stable ids and titles for localhost route artboards", () => {
    expect(makeLocalhostRouteId("/")).toBe("route-root");
    expect(makeLocalhostRouteId("/settings/profile")).toBe(
      "route-settings-profile",
    );
    expect(makeLocalhostRouteId("/design/:id")).toBe("route-design-pid");
    // Param routes and literal-hyphen routes must NOT collide:
    expect(makeLocalhostRouteId("/design-id")).toBe("route-design-id");
    // Wildcard catch-alls stay distinct from their base path:
    expect(makeLocalhostRouteId("/users")).toBe("route-users");
    expect(makeLocalhostRouteId("/users/*")).toBe("route-users-w");
    expect(makeLocalhostRouteId("/*")).toBe("route-wildcard");
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
