import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const specPath = path.resolve(import.meta.dirname, "../public/openapi.json");

describe("published OpenAPI document", () => {
  it("is a self-describing, function-calling-compatible API contract", () => {
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));

    expect(spec.openapi).toBe("3.2.0");
    expect(spec.info.title).toContain("Agent-Native");
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        "/api/desktop-latest.json",
        "/api/desktop-updates/{asset}",
        "/mcp",
      ]),
    );

    for (const pathItem of Object.values(spec.paths) as Record<string, any>[]) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) {
          continue;
        }
        expect(operation.operationId).toEqual(expect.any(String));
        expect(operation.description).toEqual(expect.any(String));
        expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
      }
    }

    expect(spec.components.schemas.ApiError.required).toEqual(
      expect.arrayContaining(["code", "message", "resolution"]),
    );
  });
});
