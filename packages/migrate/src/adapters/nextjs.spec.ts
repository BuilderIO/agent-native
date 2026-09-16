import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

import { detectNextJsSource, extractNextJsProject } from "./nextjs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../__fixtures__");

describe("nextjs source adapter", () => {
  it("detects and inventories a pages-router app", async () => {
    const root = path.join(fixtures, "next-pages");
    await expect(detectNextJsSource(root)).resolves.toBe(true);

    const ir = await extractNextJsProject(root);
    expect(ir.site.framework).toBe("nextjs");
    expect(ir.site.routes.map((route) => route.path)).toContain("/");
    expect(ir.site.routes.map((route) => route.path)).toContain("/dashboard");
    expect(ir.behavior.apiEndpoints[0]).toMatchObject({
      path: "/api/hello",
      recommendedRecipe: "api-routes-to-actions",
    });
    expect(ir.behavior.llmCalls.length).toBeGreaterThan(0);
    expect(ir.behavior.clientState.length).toBeGreaterThan(0);
  });

  it("detects and inventories an app-router app", async () => {
    const ir = await extractNextJsProject(path.join(fixtures, "next-app"));
    expect(ir.site.routes.map((route) => route.path)).toEqual([
      "/",
      "/api/hello",
      "/dashboard",
    ]);
    expect(ir.behavior.apiEndpoints[0]?.method).toBe("GET");
  });
});
