import { createApp, createRouter, defineEventHandler } from "h3";
import { describe, expect, it } from "vitest";

import { createCsrfMiddleware } from "./csrf.js";

const PATH = "/_agent-native/actions/do-thing";

function appWithCsrf(path = PATH) {
  const app = createApp();
  app.use(createCsrfMiddleware());
  const router = createRouter();
  router.post(
    path,
    defineEventHandler(() => new Response("ok")),
  );
  router.get(
    path,
    defineEventHandler(() => new Response("ok")),
  );
  app.use(router);
  return app;
}

async function status(
  headers: Record<string, string>,
  method = "POST",
  path = PATH,
) {
  const res = await appWithCsrf(path).request("http://app.example.com" + path, {
    method,
    headers,
  });
  return res.status;
}

const COOKIE = "an_session=abc";

describe("CSRF middleware", () => {
  it.each([
    "text/plain; x=application/json",
    "multipart/form-data; boundary=application/json",
    "application/x-www-form-urlencoded; charset=application/json",
  ])("does not treat %s as a JSON request", async (contentType) => {
    expect(
      await status({
        cookie: COOKIE,
        "content-type": contentType,
        "sec-fetch-site": "same-site",
      }),
    ).toBe(403);
  });

  it("accepts a cookie-bearing upload whose media type needs a preflight", async () => {
    expect(
      await status(
        {
          cookie: COOKIE,
          "content-type": "video/webm",
          "sec-fetch-site": "cross-site",
        },
        "POST",
        "/api/uploads/rec-1/chunk",
      ),
    ).not.toBe(403);
    expect(
      await status(
        { cookie: COOKIE, "sec-fetch-site": "cross-site" },
        "POST",
        "/api/uploads/rec-1/chunk",
      ),
    ).toBe(403);
  });

  it("accepts JSON with parameters", async () => {
    expect(
      await status({
        cookie: COOKIE,
        "content-type": "Application/JSON; charset=utf-8",
        "sec-fetch-site": "cross-site",
      }),
    ).not.toBe(403);
  });

  it("checks cookie-bearing template API writes", async () => {
    const path = "/api/emails/send";
    expect(
      await status(
        {
          cookie: COOKIE,
          "content-type": "application/x-www-form-urlencoded",
          "sec-fetch-site": "cross-site",
        },
        "POST",
        path,
      ),
    ).toBe(403);
    expect(
      await status(
        {
          cookie: COOKIE,
          "content-type": "multipart/form-data; boundary=x",
          "sec-fetch-site": "same-origin",
        },
        "POST",
        path,
      ),
    ).not.toBe(403);
    expect(
      await status(
        { "content-type": "application/x-www-form-urlencoded" },
        "POST",
        path,
      ),
    ).not.toBe(403);
  });

  it("protects logout-all but keeps OAuth callbacks exempt", async () => {
    const crossOrigin = {
      cookie: COOKIE,
      "content-type": "text/plain",
      "sec-fetch-site": "same-site",
    };
    expect(
      await status(crossOrigin, "POST", "/_agent-native/auth/logout-all"),
    ).toBe(403);
    expect(
      await status(
        { cookie: COOKIE, "sec-fetch-site": "same-origin" },
        "POST",
        "/_agent-native/auth/logout-all",
      ),
    ).not.toBe(403);
    expect(
      await status(crossOrigin, "POST", "/_agent-native/oauth/google/callback"),
    ).not.toBe(403);
  });
  it("protects cookie-authenticated public MCP management routes", async () => {
    expect(
      await status(
        { cookie: COOKIE, "content-type": "text/plain" },
        "POST",
        "/mcp/connect/token",
      ),
    ).toBe(403);
  });

  it("protects public MCP management routes under APP_BASE_PATH", async () => {
    const originalBasePath = process.env.APP_BASE_PATH;
    process.env.APP_BASE_PATH = "/foo";

    try {
      expect(
        await status(
          { cookie: COOKIE, "content-type": "text/plain" },
          "POST",
          "/foo/mcp/connect/token",
        ),
      ).toBe(403);
    } finally {
      if (originalBasePath === undefined) {
        delete process.env.APP_BASE_PATH;
      } else {
        process.env.APP_BASE_PATH = originalBasePath;
      }
    }
  });

  it("rejects a cookie-carrying simple request under APP_BASE_PATH", async () => {
    const originalBasePath = process.env.APP_BASE_PATH;
    process.env.APP_BASE_PATH = "/foo";

    try {
      expect(
        await status(
          { cookie: COOKIE, "content-type": "text/plain" },
          "POST",
          "/foo/_agent-native/actions/do-thing",
        ),
      ).toBe(403);
    } finally {
      if (originalBasePath === undefined) {
        delete process.env.APP_BASE_PATH;
      } else {
        process.env.APP_BASE_PATH = originalBasePath;
      }
    }
  });

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

  it("exempts integration webhooks (HMAC-verified, not cookie-authenticated)", async () => {
    expect(
      await status(
        { cookie: COOKIE, "content-type": "text/plain" },
        "POST",
        "/_agent-native/integrations/slack/webhook",
      ),
    ).not.toBe(403);
  });

  it("exempts token-authenticated automation webhooks", async () => {
    expect(
      await status(
        { cookie: COOKIE, "content-type": "application/json" },
        "POST",
        "/_agent-native/automations/webhook/" + "a".repeat(43),
      ),
    ).not.toBe(403);
  });

  it("does not exempt a nested automation management route", async () => {
    expect(
      await status(
        { cookie: COOKIE, "content-type": "text/plain" },
        "POST",
        "/_agent-native/automations/webhook/" + "a".repeat(43) + "/fire-test",
      ),
    ).toBe(403);
  });

  // The remote-device relay lives under the HMAC-justified `/integrations/`
  // exemption but authenticates on the session cookie, so it must not inherit
  // it. Approving a browser-control operation is the state change at stake:
  // without this, an attacker page can self-approve a click/type/navigate on
  // the victim's paired Chrome using nothing but their ambient cookie.
  for (const path of [
    "/_agent-native/integrations/remote/computer/approvals",
    "/_agent-native/integrations/remote/computer/commands",
    "/_agent-native/integrations/remote/register",
    "/_agent-native/integrations/remote/enqueue",
  ]) {
    it(`protects cookie-authenticated relay route ${path}`, async () => {
      expect(
        await status(
          { cookie: COOKIE, "content-type": "text/plain" },
          "POST",
          path,
        ),
      ).toBe(403);
    });
  }

  it("still lets the extension's own device-token relay calls through", async () => {
    expect(
      await status(
        { "content-type": "application/json" },
        "POST",
        "/_agent-native/integrations/remote/poll",
      ),
    ).not.toBe(403);
  });
  describe.each([
    "/_agent-native/auth/two-factor/enable",
    "/_agent-native/auth/two-factor/disable",
    "/_agent-native/integrations/scopes",
    "/_agent-native/integrations/budgets",
    "/_agent-native/integrations/memory",
    "/_agent-native/integrations/installations",
    "/_agent-native/integrations/slack/enable",
    "/_agent-native/integrations/slack/disable",
    "/_agent-native/integrations/email/setup",
  ])("session-authenticated route %s", (path) => {
    it("rejects a cookie-bearing form POST", async () => {
      expect(
        await status(
          {
            cookie: COOKIE,
            "content-type": "application/x-www-form-urlencoded",
            "sec-fetch-site": "cross-site",
          },
          "POST",
          path,
        ),
      ).toBe(403);
    });

    it("accepts JSON", async () => {
      expect(
        await status(
          {
            cookie: COOKIE,
            "content-type": "application/json",
            "sec-fetch-site": "cross-site",
          },
          "POST",
          path,
        ),
      ).not.toBe(403);
    });

    it("accepts a request with no cookie", async () => {
      expect(
        await status(
          { "content-type": "application/x-www-form-urlencoded" },
          "POST",
          path,
        ),
      ).not.toBe(403);
    });
  });
});
