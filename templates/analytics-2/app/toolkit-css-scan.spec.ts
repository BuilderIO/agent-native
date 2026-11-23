// @vitest-environment node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { createServer } from "vite";
import { describe, expect, it } from "vitest";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));
const GLOBAL_CSS = fileURLToPath(new URL("./global.css", import.meta.url));

async function compileGlobalCss(transformSource?: (css: string) => string) {
  const server = await createServer({
    root: APP_ROOT,
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    plugins: [
      tailwindcss(),
      {
        name: "toolkit-css-scan-probe",
        enforce: "pre",
        load(id) {
          if (!transformSource || id.split("?")[0] !== GLOBAL_CSS) return null;
          return transformSource(readFileSync(GLOBAL_CSS, "utf8"));
        },
      },
    ],
  });
  try {
    const result = await server.transformRequest("/app/global.css?direct");
    return result?.code ?? "";
  } finally {
    await server.close();
  }
}

describe("analytics-2 stylesheet covers the toolkit tooltip classes", () => {
  it("emits the tooltip stacking and transform-origin rules", async () => {
    const css = await compileGlobalCss();
    expect(css).toContain("z-\\[500\\]");
    expect(css).toContain("radix-tooltip-content-transform-origin");
  }, 120_000);

  it("loses them when neither the toolkit styles nor its dist are registered", async () => {
    const css = await compileGlobalCss((source) =>
      source
        .replace(/^@import "@agent-native\/toolkit\/styles.css";\n/m, "")
        .replace(
          /^@source "\.\.\/node_modules\/@agent-native\/toolkit\/dist";\n/m,
          "",
        ),
    );
    expect(css).not.toContain("z-\\[500\\]");
  }, 120_000);
});
