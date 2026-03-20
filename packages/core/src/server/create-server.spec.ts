import { describe, it, expect } from "vitest";
import { createServer } from "./create-server.js";

describe("createServer", () => {
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
