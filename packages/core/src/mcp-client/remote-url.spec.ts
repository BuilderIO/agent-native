import { describe, expect, it } from "vitest";

import { maskRemoteUrl } from "./remote-url.js";

describe("maskRemoteUrl", () => {
  it.each([
    "https://mcp.example.test/mcp",
    "https://mcp.example.test/v1/mcp/authv2",
    "https://mcp.example.test/api/v4/mcp",
    "https://mcp.example.test/streamable-http/endpoint",
    "https://mcp.example.test:8443/mcp/",
  ])("keeps %s as it is", (url) => {
    expect(maskRemoteUrl(url)).toBe(url);
  });

  it("adds the root path to a bare origin", () => {
    expect(maskRemoteUrl("https://mcp.example.test")).toBe(
      "https://mcp.example.test/",
    );
  });

  it("hides a key in the query and keeps the origin and path", () => {
    const masked = maskRemoteUrl(
      "https://mcp.example.test/mcp?api_key=example-fake-key-123&team=acme#frag",
    );

    expect(masked).toBe("https://mcp.example.test/mcp?[hidden]");
    expect(masked).not.toContain("example-fake-key-123");
    expect(masked).not.toContain("team");
  });

  it("hides userinfo", () => {
    const masked = maskRemoteUrl(
      "https://user:example-fake-password@mcp.example.test/mcp",
    );

    expect(masked).toBe("https://[hidden]@mcp.example.test/mcp");
    expect(masked).not.toContain("example-fake-password");
    expect(masked).not.toContain("user:");
  });

  it("hides the segment after a key label, whatever its length", () => {
    expect(maskRemoteUrl("https://mcp.example.test/s/abc/mcp")).toBe(
      "https://mcp.example.test/s/[hidden]/mcp",
    );
    expect(maskRemoteUrl("https://mcp.example.test/token/abc")).toBe(
      "https://mcp.example.test/token/[hidden]",
    );
  });

  it.each([
    ["a random mixed-case token", "ExampleFakeSegment1234"],
    ["a UUID", "3f2b8c1e-9d4a-4b6f-8a7c-1e2d3c4b5a69"],
    ["a prefixed key", "sk_live_51Hexamplefake00000000"],
    ["a hex digest", "9f86d081884c7d659a2feaa0c55ad015"],
  ])("hides %s used as a path segment", (_name, secret) => {
    const masked = maskRemoteUrl(
      `https://mcp.example.test/hooks/${secret}/mcp`,
    );

    expect(masked).toBe("https://mcp.example.test/hooks/[hidden]/mcp");
    expect(masked).not.toContain(secret);
  });

  it("hides the value of a name=value path segment", () => {
    expect(
      maskRemoteUrl("https://mcp.example.test/api_key=example-fake-key/mcp"),
    ).toBe("https://mcp.example.test/api_key=[hidden]/mcp");
  });

  it("hides a URL that cannot be read instead of passing it through", () => {
    expect(maskRemoteUrl("https://example-fake-key@")).toBe("[hidden]");
    expect(maskRemoteUrl("not a url with example-fake-key")).toBe("[hidden]");
  });
});
