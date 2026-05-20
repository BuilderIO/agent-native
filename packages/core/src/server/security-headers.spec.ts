import { describe, expect, it, vi } from "vitest";

const headers = new Map<string, string>();

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getCookie: (event: any, name: string) => event.cookies?.[name],
  getQuery: (event: any) => event.query ?? {},
  setResponseHeader: (_event: any, name: string, value: string) => {
    headers.set(name, value);
  },
}));

import { createSecurityHeadersMiddleware } from "./security-headers.js";

describe("security headers middleware", () => {
  it("allows same-origin microphone prompts for composer dictation", () => {
    headers.clear();

    const handler = createSecurityHeadersMiddleware();
    handler({ url: { protocol: "https:" }, node: { req: { headers: {} } } });

    expect(headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(self), geolocation=(), screen-wake-lock=()",
    );
  });

  it("omits X-Frame-Options for embed-token page loads in production", () => {
    headers.clear();
    vi.stubEnv("NODE_ENV", "production");

    const handler = createSecurityHeadersMiddleware();
    handler({
      query: { __an_embed_token: "tok" },
      url: { protocol: "https:" },
      node: { req: { headers: {} } },
    });

    expect(headers.get("X-Frame-Options")).toBeUndefined();
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    vi.unstubAllEnvs();
  });
});
