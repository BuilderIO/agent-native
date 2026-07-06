import { createHash } from "node:crypto";

import { createApp, createRouter, defineEventHandler } from "h3";
import { describe, expect, it } from "vitest";

import {
  computeInlineScriptHash,
  createSecurityHeadersMiddleware,
} from "./security-headers.js";

describe("createSecurityHeadersMiddleware", () => {
  it("does not emit frame-blocking headers for production app pages", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = createApp();
      app.use(createSecurityHeadersMiddleware());

      const router = createRouter();
      router.get(
        "/library",
        defineEventHandler(() => {
          return new Response("ok");
        }),
      );
      app.use(router);

      const res = await app.request("https://assets.agent-native.com/library");

      expect(res.headers.get("X-Frame-Options")).toBeNull();
      expect(res.headers.get("Content-Security-Policy")).toBeNull();
      expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBeNull();
      expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("same-site");
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it("allows MCP resources to be consumed by cross-origin app sandboxes", async () => {
    const app = createApp();
    app.use(createSecurityHeadersMiddleware());

    const router = createRouter();
    router.post(
      "/_agent-native/mcp",
      defineEventHandler(() => {
        return new Response("ok");
      }),
    );
    app.use(router);

    const res = await app.request("http://localhost/_agent-native/mcp", {
      method: "POST",
      headers: {
        origin: "https://520ba469ac5783c72c33d79bea940871.claudemcpcontent.com",
      },
    });

    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "cross-origin",
    );
  });

  it("keeps ordinary app responses same-site", async () => {
    const app = createApp();
    app.use(createSecurityHeadersMiddleware());

    const router = createRouter();
    router.get(
      "/settings",
      defineEventHandler(() => {
        return new Response("ok");
      }),
    );
    app.use(router);

    const res = await app.request("http://localhost/settings");

    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe("same-site");
  });

  it("does not set Content-Security-Policy", async () => {
    const app = createApp();
    app.use(createSecurityHeadersMiddleware());

    const router = createRouter();
    router.get(
      "/settings",
      defineEventHandler(() => {
        return new Response("ok");
      }),
    );
    app.use(router);

    const res = await app.request("http://localhost/settings");

    // App documents intentionally omit CSP so framework bootstrap scripts and
    // Google Tag Manager are not blocked by a shared header.
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
  });

  it("allows iframe navigations to satisfy cross-origin isolated parents", async () => {
    const app = createApp();
    app.use(createSecurityHeadersMiddleware());

    const router = createRouter();
    router.get(
      "/library",
      defineEventHandler(() => {
        return new Response("ok");
      }),
    );
    app.use(router);

    const res = await app.request("https://assets.agent-native.com/library", {
      headers: {
        "sec-fetch-dest": "iframe",
      },
    });

    expect(res.headers.get("X-Frame-Options")).toBeNull();
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "cross-origin",
    );
    expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBe(
      "require-corp",
    );
  });
});

describe("computeInlineScriptHash", () => {
  it("produces a sha256-<base64> token matching the Node crypto output", () => {
    const body = "alert(1)";
    const expected =
      "'sha256-" + createHash("sha256").update(body).digest("base64") + "'";
    expect(computeInlineScriptHash(body)).toBe(expected);
  });

  it("produces different hashes for different script bodies", () => {
    const h1 = computeInlineScriptHash("console.log(1)");
    const h2 = computeInlineScriptHash("console.log(2)");
    expect(h1).not.toBe(h2);
  });
});
