import { describe, expect, it } from "vitest";

import { renderNetlifyStaticHeaders } from "./netlify-static-headers.js";

describe("renderNetlifyStaticHeaders", () => {
  it("marks the framework namespace no-store under the default prefix", () => {
    const rendered = renderNetlifyStaticHeaders({});
    expect(rendered).toContain("/_agent-native/*");
    expect(rendered).not.toContain("/_platform/*");
  });

  it("follows the configured public prefix", () => {
    const rendered = renderNetlifyStaticHeaders({
      AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX: "/_platform",
    });
    expect(rendered).toContain("/_platform/*");
    expect(rendered).not.toContain("/_agent-native/*");
  });

  it("also covers the mounted namespace under APP_BASE_PATH", () => {
    const rendered = renderNetlifyStaticHeaders({
      AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX: "/_platform",
      APP_BASE_PATH: "/docs",
    });
    expect(rendered).toContain("/_platform/*");
    expect(rendered).toContain("/docs/_platform/*");
  });

  it("refuses a malformed deployment prefix", () => {
    expect(() =>
      renderNetlifyStaticHeaders({
        AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX: "/api",
      }),
    ).toThrow(/reserved namespace/);
  });
});
