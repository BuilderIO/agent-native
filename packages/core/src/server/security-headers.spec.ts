import { describe, expect, it, vi } from "vitest";

const headers = new Map<string, string>();

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
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
});
