import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const repoRoot = path.resolve(packageRoot, "../..");

describe("dispatch Tailwind styles", () => {
  it("exports package source directives for consuming apps", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8"),
    ) as { exports?: Record<string, string> };
    const stylesheet = fs.readFileSync(
      path.join(packageRoot, "src/styles/dispatch.css"),
      "utf-8",
    );

    expect(pkg.exports?.["./styles/dispatch.css"]).toBe(
      "./src/styles/dispatch.css",
    );
    expect(stylesheet).toContain(
      '@source "../components/**/*.{js,mjs,ts,tsx}"',
    );
    expect(stylesheet).toContain('@source "../routes/**/*.{js,mjs,ts,tsx}"');
  });

  it("imports package source directives from the Dispatch template", () => {
    const globalCss = fs.readFileSync(
      path.join(repoRoot, "templates/dispatch/app/global.css"),
      "utf-8",
    );

    expect(globalCss).toContain(
      '@import "@agent-native/dispatch/styles/dispatch.css";',
    );
  });
});

describe("dispatch route shells", () => {
  it("re-exports the index route redirects from the Dispatch template", () => {
    const indexRoute = fs.readFileSync(
      path.join(repoRoot, "templates/dispatch/app/routes/_index.tsx"),
      "utf-8",
    );

    expect(indexRoute).toContain("loader");
    expect(indexRoute).toContain("clientLoader");
    expect(indexRoute).toContain("HydrateFallback");
    expect(indexRoute).toContain("@agent-native/dispatch/routes/pages/_index");
  });
});
