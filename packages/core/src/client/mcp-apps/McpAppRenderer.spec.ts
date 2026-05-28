import { describe, expect, it } from "vitest";
import {
  buildMcpAppCsp,
  clampMcpAppHeight,
  DEFAULT_MCP_APP_IFRAME_HEIGHT,
  supportedMcpAppPermissions,
} from "./McpAppRenderer.js";

describe("McpAppRenderer security helpers", () => {
  it("grants only supported iframe permissions", () => {
    expect(
      supportedMcpAppPermissions({
        camera: {},
        microphone: {},
        geolocation: {},
        clipboardWrite: {},
      }),
    ).toEqual({ clipboardWrite: {} });
  });

  it("defaults to 650px and caps reported height to the visible viewport", () => {
    expect(DEFAULT_MCP_APP_IFRAME_HEIGHT).toBe(650);
    expect(clampMcpAppHeight(1200, 700)).toBe(700);
    expect(clampMcpAppHeight(420, 700)).toBe(420);
    expect(clampMcpAppHeight(120, 700)).toBe(220);
    expect(clampMcpAppHeight(420, 180)).toBe(180);
  });

  it("builds a restrictive CSP and drops invalid source expressions", () => {
    const csp = buildMcpAppCsp({
      connectDomains: [
        "https://api.example.com/v1",
        "javascript:alert(1)",
        "https://bad.example.com; script-src *",
      ],
      resourceDomains: [
        "https://cdn.example.com/assets",
        "http://localhost:5173",
      ],
      frameDomains: [
        "https:",
        "https://frames.example.com",
        "http://localhost:*",
        "http://127.0.0.1:*",
        "http://evil.example:*",
      ],
    });

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src https://api.example.com");
    expect(csp).not.toContain("javascript:");
    expect(csp).not.toContain("bad.example.com");
    expect(csp).toContain("style-src 'unsafe-inline' https://cdn.example.com");
    expect(csp).toContain("http://localhost:5173");
    expect(csp).toContain(
      "frame-src https: https://frames.example.com http://localhost:* http://127.0.0.1:*",
    );
    expect(csp).not.toContain("http://evil.example:*");
  });
});
