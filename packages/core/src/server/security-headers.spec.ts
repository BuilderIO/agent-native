import { createApp, createRouter, defineEventHandler } from "h3";
import { describe, expect, it } from "vitest";
import { createSecurityHeadersMiddleware } from "./security-headers.js";

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
