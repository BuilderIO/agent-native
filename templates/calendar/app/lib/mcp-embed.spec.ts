import { afterEach, describe, expect, it, vi } from "vitest";

import { isMcpEmbedSurface } from "./mcp-embed";

describe("isMcpEmbedSurface (calendar)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false outside the browser", () => {
    expect(isMcpEmbedSurface()).toBe(false);
  });

  it("detects ?embedded=1 query params (MCP iframe surface)", () => {
    vi.stubGlobal("window", { location: { search: "?embedded=1" } });
    expect(isMcpEmbedSurface()).toBe(true);
  });

  it("accepts the truthy 'true' legacy value", () => {
    vi.stubGlobal("window", { location: { search: "?embedded=true" } });
    expect(isMcpEmbedSurface()).toBe(true);
  });

  it("ignores ordinary in-app routes without the embed flag", () => {
    vi.stubGlobal("window", { location: { search: "?date=2026-05-23" } });
    expect(isMcpEmbedSurface()).toBe(false);
  });
});
