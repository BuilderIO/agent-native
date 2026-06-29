import { describe, expect, it } from "vitest";

import {
  makeLocalhostRouteId,
  normalizeDesignSourceType,
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
    expect(makeLocalhostRouteId("/design/:id")).toBe("route-design-id");
    expect(makeLocalhostRouteId("/*")).toBe("route-wildcard");
    expect(titleFromRoutePath("/design/:id")).toBe("Design Id");
    expect(titleFromRoutePath("/*")).toBe("Wildcard");
  });
});
