import { afterEach, describe, expect, it, vi } from "vitest";
import { isMcpEmbedSurface } from "./mcp-embed";

describe("isMcpEmbedSurface", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false outside the browser", () => {
    expect(isMcpEmbedSurface()).toBe(false);
  });

  it("detects ticketed MCP embed routes", () => {
    vi.stubGlobal("window", { location: { search: "?embedded=1" } });

    expect(isMcpEmbedSurface()).toBe(true);
  });

  it("accepts true for legacy embed query values", () => {
    vi.stubGlobal("window", { location: { search: "?embedded=true" } });

    expect(isMcpEmbedSurface()).toBe(true);
  });

  it("ignores ordinary routes", () => {
    vi.stubGlobal("window", { location: { search: "?view=inbox" } });

    expect(isMcpEmbedSurface()).toBe(false);
  });
});
