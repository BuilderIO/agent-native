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
import {
  EMBED_SESSION_COOKIE,
  EMBED_TARGET_HEADER,
} from "../shared/embed-auth.js";
import { signEmbedSessionToken } from "./embed-session.js";

describe("security headers middleware", () => {
  it("allows same-origin microphone prompts for composer dictation", () => {
    headers.clear();

    const handler = createSecurityHeadersMiddleware();
    handler({ url: { protocol: "https:" }, node: { req: { headers: {} } } });

    expect(headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(self), geolocation=(), screen-wake-lock=()",
    );
    expect(headers.get("Cross-Origin-Embedder-Policy")).toBeUndefined();
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("same-site");
  });

  it("relaxes frame headers for embed-token page loads in production", () => {
    headers.clear();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OAUTH_STATE_SECRET", "embed-test-secret");
    const token = signEmbedSessionToken({
      ownerEmail: "user@example.test",
      targetPath: "/inbox",
      ttlSeconds: 60,
    });

    const handler = createSecurityHeadersMiddleware();
    handler({
      path: "/inbox",
      query: { __an_embed_token: token },
      url: { protocol: "https:" },
      node: { req: { headers: {} } },
    });

    expect(headers.get("X-Frame-Options")).toBeUndefined();
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    vi.unstubAllEnvs();
  });

  it("relaxes frame headers for cookie-only embed page reloads after token stripping", () => {
    headers.clear();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OAUTH_STATE_SECRET", "embed-test-secret");
    const token = signEmbedSessionToken({
      ownerEmail: "user@example.test",
      targetPath: "/inbox",
      ttlSeconds: 60,
    });

    const handler = createSecurityHeadersMiddleware();
    handler({
      path: "/inbox",
      query: { embedded: "1" },
      cookies: { [EMBED_SESSION_COOKIE]: token },
      headers: new Headers({ [EMBED_TARGET_HEADER]: "/inbox?embedded=1" }),
      request: {
        headers: new Headers({ [EMBED_TARGET_HEADER]: "/inbox?embedded=1" }),
      },
      url: { protocol: "https:" },
      node: {
        req: {
          url: "/inbox?embedded=1",
          headers: {
            cookie: `${EMBED_SESSION_COOKIE}=${token}`,
            [EMBED_TARGET_HEADER]: "/inbox?embedded=1",
          },
        },
      },
    });

    expect(headers.get("X-Frame-Options")).toBeUndefined();
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
    vi.unstubAllEnvs();
  });
});
