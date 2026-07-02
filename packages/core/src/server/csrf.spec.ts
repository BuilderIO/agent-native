import { createApp, createRouter, defineEventHandler } from "h3";
import { describe, expect, it } from "vitest";

import { createCsrfMiddleware } from "./csrf.js";

const PATH = "/_agent-native/actions/do-thing";

function appWithCsrf() {
  const app = createApp();
  app.use(createCsrfMiddleware());
  const router = createRouter();
  router.post(
    PATH,
    defineEventHandler(() => new Response("ok")),
  );
  router.get(
    PATH,
    defineEventHandler(() => new Response("ok")),
  );
  app.use(router);
  return app;
}

async function status(headers: Record<string, string>, method = "POST") {
  const res = await appWithCsrf().request("http://app.example.com" + PATH, {
    method,
    headers,
  });
  return res.status;
}

const COOKIE = "an_session=abc";

describe("CSRF middleware", () => {
  it("REJECTS a cross-site request labelled Sec-Fetch-Site: same-site (the fix)", async () => {
    expect(
      await status({ cookie: COOKIE, "sec-fetch-site": "same-site" }),
    ).toBe(403);
  });

  it("allows same-origin", async () => {
    expect(
      await status({ cookie: COOKIE, "sec-fetch-site": "same-origin" }),
    ).not.toBe(403);
  });

  it("allows the custom CSRF header even when same-site", async () => {
    expect(
      await status({
        cookie: COOKIE,
        "sec-fetch-site": "same-site",
        "x-agent-native-csrf": "1",
      }),
    ).not.toBe(403);
  });

  it("allows application/json content-type", async () => {
    expect(
      await status({
        cookie: COOKIE,
        "sec-fetch-site": "same-site",
        "content-type": "application/json",
      }),
    ).not.toBe(403);
  });

  it("lets cookieless requests through (server-to-server)", async () => {
    expect(await status({ "sec-fetch-site": "same-site" })).not.toBe(403);
  });

  it("ignores non-state-changing methods", async () => {
    expect(
      await status({ cookie: COOKIE, "sec-fetch-site": "same-site" }, "GET"),
    ).not.toBe(403);
  });
});
