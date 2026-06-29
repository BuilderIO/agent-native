import { afterEach, describe, it, expect, vi } from "vitest";

import { createServer } from "./create-server.js";

describe("createServer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns an H3 app and router", () => {
    const { app, router } = createServer();
    expect(app).toBeDefined();
    expect(router).toBeDefined();
    expect(typeof router.get).toBe("function");
    expect(typeof router.post).toBe("function");
  });

  it("disables CORS when cors is false", () => {
    // Should not throw
    const { app } = createServer({ cors: false });
    expect(app).toBeDefined();
  });

  it("accepts custom jsonLimit", () => {
    const { app } = createServer({ jsonLimit: "1mb" });
    expect(app).toBeDefined();
  });

  it.each([
    "https://520ba469ac5783c72c33d79bea940871.claudemcpcontent.com",
    "https://shakira-professor-conscious-frederick-trycloudflare-com.web-sandbox.oaiusercontent.com",
  ])("allows MCP app transplant preflights from %s", async (origin) => {
    const { app } = createServer();

    const res = await app.request(
      "http://localhost/_agent-native/embed/start?ticket=test-ticket",
      {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "GET",
          "access-control-request-headers":
            "accept, x-agent-native-embed-transplant",
        },
      },
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
      "X-Agent-Native-Embed-Transplant",
    );
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain(
      "X-User-Timezone",
    );
  });

  it("reports deploy-time env values as configured", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://deploy.example/db");
    const { app } = createServer({
      envKeys: [{ key: "DATABASE_URL", label: "Database URL" }],
    });

    const res = await app.request("http://localhost/_agent-native/env-status");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        key: "DATABASE_URL",
        label: "Database URL",
        required: false,
        configured: true,
      },
    ]);
  });

  it("rejects env-var writes outside the configured key list", async () => {
    const { app } = createServer({
      envKeys: [{ key: "GOOGLE_CLIENT_ID", label: "Google client ID" }],
    });

    const res = await app.request("http://localhost/_agent-native/env-vars", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vars: [{ key: "GOOGLE_CLIENT_SECRET", value: "secret" }],
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Unsupported env key: GOOGLE_CLIENT_SECRET",
    });
  });
});

// Test parseEnvFile behavior by reimplementing and testing the same logic
// since the function is private to the module
describe("parseEnvFile (logic)", () => {
  function parseEnvFile(content: string): Map<string, string> {
    const vars = new Map<string, string>();
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      vars.set(key, value);
    }
    return vars;
  }

  it("parses simple key=value pairs", () => {
    const result = parseEnvFile("FOO=bar\nBAZ=qux");
    expect(result.get("FOO")).toBe("bar");
    expect(result.get("BAZ")).toBe("qux");
  });

  it("strips double quotes", () => {
    const result = parseEnvFile('API_KEY="my-secret"');
    expect(result.get("API_KEY")).toBe("my-secret");
  });

  it("strips single quotes", () => {
    const result = parseEnvFile("API_KEY='my-secret'");
    expect(result.get("API_KEY")).toBe("my-secret");
  });

  it("skips comments", () => {
    const result = parseEnvFile("# This is a comment\nFOO=bar");
    expect(result.size).toBe(1);
    expect(result.get("FOO")).toBe("bar");
  });

  it("skips empty lines", () => {
    const result = parseEnvFile("\n\nFOO=bar\n\n");
    expect(result.size).toBe(1);
  });

  it("skips lines without =", () => {
    const result = parseEnvFile("INVALID\nFOO=bar");
    expect(result.size).toBe(1);
  });

  it("handles values with = in them", () => {
    const result = parseEnvFile("URL=https://example.com?a=1&b=2");
    expect(result.get("URL")).toBe("https://example.com?a=1&b=2");
  });

  it("handles empty value", () => {
    const result = parseEnvFile("EMPTY=");
    expect(result.get("EMPTY")).toBe("");
  });

  it("trims whitespace around key and value", () => {
    const result = parseEnvFile("  FOO  =  bar  ");
    expect(result.get("FOO")).toBe("bar");
  });
});
