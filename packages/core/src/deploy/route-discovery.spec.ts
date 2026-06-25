import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect } from "vitest";

import {
  discoverActionFiles,
  parseActionHttpConfig,
  parseRouteFile,
} from "./route-discovery.js";

const defineActionSource = (httpConfig: string, body = "") =>
  `import { defineAction } from "@agent-native/core";\n` +
  `export default defineAction({\n` +
  `  tool: { description: "ok", parameters: {} },\n` +
  (httpConfig ? `  http: ${httpConfig},\n` : "") +
  `  run: async () => {\n${body}\n    return { ok: true };\n  },\n` +
  `});\n`;

describe("parseRouteFile", () => {
  it("parses a simple GET route", () => {
    expect(parseRouteFile("api/events.get.ts")).toEqual({
      method: "get",
      route: "/api/events",
    });
  });

  it("parses a POST route", () => {
    expect(parseRouteFile("api/users.post.ts")).toEqual({
      method: "post",
      route: "/api/users",
    });
  });

  it("parses PUT, PATCH, DELETE, OPTIONS methods", () => {
    expect(parseRouteFile("api/item.put.ts")?.method).toBe("put");
    expect(parseRouteFile("api/item.patch.ts")?.method).toBe("patch");
    expect(parseRouteFile("api/item.delete.ts")?.method).toBe("delete");
    expect(parseRouteFile("api/cors.options.ts")?.method).toBe("options");
  });

  it("handles index files by stripping /index", () => {
    expect(parseRouteFile("api/emails/index.get.ts")).toEqual({
      method: "get",
      route: "/api/emails",
    });
  });

  it("converts [param] to :param", () => {
    expect(parseRouteFile("api/emails/[id].get.ts")).toEqual({
      method: "get",
      route: "/api/emails/:id",
    });
  });

  it("handles nested params", () => {
    expect(parseRouteFile("api/emails/[id]/star.patch.ts")).toEqual({
      method: "patch",
      route: "/api/emails/:id/star",
    });
  });

  it("converts [...catchall] to **", () => {
    expect(parseRouteFile("api/[...page].get.ts")).toEqual({
      method: "get",
      route: "/api/**",
    });
  });

  it("returns null for files without method extension", () => {
    expect(parseRouteFile("api/utils.ts")).toBeNull();
  });

  it("returns null for invalid method extension", () => {
    expect(parseRouteFile("api/thing.foobar.ts")).toBeNull();
  });

  it("handles .js extensions", () => {
    expect(parseRouteFile("api/hello.get.js")).toEqual({
      method: "get",
      route: "/api/hello",
    });
  });

  it("case-insensitive method matching", () => {
    // The method in the filename is lowercased
    expect(parseRouteFile("api/data.GET.ts")).toEqual({
      method: "get",
      route: "/api/data",
    });
  });

  it("handles multiple path segments", () => {
    expect(parseRouteFile("api/v1/users/[id]/settings.get.ts")).toEqual({
      method: "get",
      route: "/api/v1/users/:id/settings",
    });
  });

  it("handles multiple params in one path", () => {
    expect(parseRouteFile("api/[org]/[repo]/issues.get.ts")).toEqual({
      method: "get",
      route: "/api/:org/:repo/issues",
    });
  });
});

describe("parseActionHttpConfig", () => {
  it("defaults to POST with no path when http is unset", () => {
    expect(parseActionHttpConfig(defineActionSource(""))).toEqual({
      method: "post",
    });
  });

  it("reads method: GET from the http config", () => {
    expect(
      parseActionHttpConfig(defineActionSource(`{ method: "GET" }`)),
    ).toEqual({ method: "get" });
  });

  it("supports PUT, PATCH, DELETE, OPTIONS — not just GET", () => {
    expect(
      parseActionHttpConfig(defineActionSource(`{ method: "PUT" }`)).method,
    ).toBe("put");
    expect(
      parseActionHttpConfig(defineActionSource(`{ method: "PATCH" }`)).method,
    ).toBe("patch");
    expect(
      parseActionHttpConfig(defineActionSource(`{ method: "DELETE" }`)).method,
    ).toBe("delete");
    expect(
      parseActionHttpConfig(defineActionSource(`{ method: "OPTIONS" }`)).method,
    ).toBe("options");
  });

  it("accepts single-quoted method values", () => {
    expect(
      parseActionHttpConfig(defineActionSource(`{ method: 'GET' }`)).method,
    ).toBe("get");
  });

  it("extracts http.path when present", () => {
    expect(
      parseActionHttpConfig(
        defineActionSource(`{ method: "GET", path: "custom-route" }`),
      ),
    ).toEqual({ method: "get", path: "custom-route" });
  });

  it("reads method and path after a nested object in the http config", () => {
    expect(
      parseActionHttpConfig(
        defineActionSource(
          `{
            headers: { "Cache-Control": "no-store" },
            method: "GET",
            path: "nested-route"
          }`,
        ),
      ),
    ).toEqual({ method: "get", path: "nested-route" });
  });

  it("returns false for http: false (agent-only)", () => {
    expect(parseActionHttpConfig(defineActionSource("false"))).toBe(false);
  });

  it("tolerates whitespace in http: false", () => {
    expect(parseActionHttpConfig(`http:false`)).toBe(false);
    expect(parseActionHttpConfig(`http :  false`)).toBe(false);
  });

  it("does NOT flip method on a method: key outside the http config", () => {
    // Regression: a GET fetch in the action body must not turn a POST action
    // into a GET route. The old content.includes('method: "GET"') scan did.
    const src = defineActionSource(
      "",
      `    await fetch("https://example.com", { method: "GET" });`,
    );
    expect(parseActionHttpConfig(src)).toEqual({ method: "post" });
  });

  it("ignores an unknown method value and keeps the POST default", () => {
    expect(
      parseActionHttpConfig(defineActionSource(`{ method: "TRACE" }`)).method,
    ).toBe("post");
  });
});

describe("discoverActionFiles", () => {
  it("ignores test files in actions/ even if they mention defineAction", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-actions-"));
    try {
      const actionsDir = path.join(root, "actions");
      fs.mkdirSync(actionsDir);
      fs.writeFileSync(
        path.join(actionsDir, "real-action.ts"),
        `import { defineAction } from "@agent-native/core";\nexport default defineAction({ tool: { description: "ok", parameters: {} }, run: async () => ({ ok: true }) });\n`,
      );
      fs.writeFileSync(
        path.join(actionsDir, "real-action.spec.ts"),
        `// Regression guard: mentioning defineAction here must not mount this file.\nexport default {};\n`,
      );
      fs.writeFileSync(
        path.join(actionsDir, "other.test.ts"),
        `const text = "defineAction";\nexport default {};\n`,
      );

      await expect(discoverActionFiles(root)).resolves.toEqual([
        {
          name: "real-action",
          absPath: path.join(actionsDir, "real-action.ts"),
          method: "post",
        },
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("discovers method, http.path, and skips agent-only actions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-actions-"));
    try {
      const actionsDir = path.join(root, "actions");
      fs.mkdirSync(actionsDir);
      fs.writeFileSync(
        path.join(actionsDir, "get-thing.ts"),
        defineActionSource(`{ method: "GET" }`),
      );
      fs.writeFileSync(
        path.join(actionsDir, "custom-path.ts"),
        defineActionSource(`{ method: "GET", path: "aliased" }`),
      );
      fs.writeFileSync(
        path.join(actionsDir, "nested-http.ts"),
        defineActionSource(
          `{
            headers: { "Cache-Control": "no-store" },
            method: "GET",
            path: "nested-route"
          }`,
        ),
      );
      fs.writeFileSync(
        path.join(actionsDir, "agent-only.ts"),
        defineActionSource("false"),
      );
      // POST action whose body does a GET fetch — must stay POST.
      fs.writeFileSync(
        path.join(actionsDir, "posts-then-gets.ts"),
        defineActionSource(
          "",
          `    await fetch("https://example.com", { method: "GET" });`,
        ),
      );

      const discovered = await discoverActionFiles(root);
      const byName = Object.fromEntries(discovered.map((a) => [a.name, a]));

      expect(byName["agent-only"]).toBeUndefined();
      expect(byName["get-thing"]).toMatchObject({ method: "get" });
      expect(byName["get-thing"].path).toBeUndefined();
      expect(byName["custom-path"]).toMatchObject({
        method: "get",
        path: "aliased",
      });
      expect(byName["nested-http"]).toMatchObject({
        method: "get",
        path: "nested-route",
      });
      expect(byName["posts-then-gets"]).toMatchObject({ method: "post" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
