import { describe, expect, it } from "vitest";

import {
  desktopClientRouteSource,
  isDesktopClientBuild,
} from "./desktop-client.js";

describe("desktop client route contract", () => {
  it("keeps a shared implementation for the client while removing the server export", () => {
    const result = desktopClientRouteSource(
      "export function loader() { return 3; }\nexport const clientLoader = loader;",
      "route.tsx",
    );
    expect(result).toContain("function loader()");
    expect(result).not.toContain("export function loader");
    expect(result).toContain("export const clientLoader = loader");
  });
  it("preserves client re-exports", () => {
    expect(
      desktopClientRouteSource(
        'export { landing as loader, landing as clientLoader } from "./landing";',
        "route.tsx",
      ),
    ).toBe('export { landing as clientLoader } from "./landing";');
  });
  it("refuses loaders and mutations without explicit client equivalents", () => {
    expect(() =>
      desktopClientRouteSource("export function loader() {}", "route.tsx"),
    ).toThrow("clientLoader");
    expect(() =>
      desktopClientRouteSource(
        "export function action() {} export function clientLoader() {}",
        "route.tsx",
      ),
    ).toThrow("clientAction");
  });
  it("only enables the explicit build switch", () => {
    expect(isDesktopClientBuild({})).toBe(false);
    expect(isDesktopClientBuild({ AGENT_NATIVE_CLIENT_ONLY: "1" })).toBe(true);
  });
});
