import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const DOCS_ROOT = path.resolve(import.meta.dirname, "..");
const CLIENT_DIR = path.join(DOCS_ROOT, "dist");
const SERVER_DIR = path.join(
  DOCS_ROOT,
  ".netlify",
  "functions-internal",
  "server",
);

const built = existsSync(path.join(CLIENT_DIR, "assets"));
const serverBuilt = existsSync(SERVER_DIR);
const describeBuilt = built ? describe : describe.skip;
const describeServer = serverBuilt ? describe : describe.skip;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describeBuilt("prerendered homepage", () => {
  it("ships no GPU code in the prerendered HTML", () => {
    const index = path.join(CLIENT_DIR, "index.html");
    expect(existsSync(index)).toBe(true);
    const html = readFileSync(index, "utf8");
    expect(html).not.toContain("navigator.gpu");
    expect(html).not.toContain("requestAdapter");
    expect(html).not.toContain("@fragment");
    expect(html).not.toContain("textureSample");
  });
});

describeBuilt("client bundle", () => {
  it("ships no WebGPU ocean renderer alongside the hero ribbon", () => {
    // oracle-change: the homepage hero moved from the lazy WebGPU ocean to the WebGL2 ribbon, so the ocean chunk assertions no longer describe shipped code.
    const withOcean = walk(path.join(CLIENT_DIR, "assets"))
      .filter((file) => file.endsWith(".js"))
      .filter((file) => readFileSync(file, "utf8").includes("fft-ocean-live"));
    expect(withOcean.map((file) => path.relative(DOCS_ROOT, file))).toEqual([]);
  });
});

describeServer("server bundle", () => {
  it("keeps the Dawn native adapter out of the docs function", () => {
    const offenders = walk(SERVER_DIR).filter((file) => {
      if (/(?:vgpu|dawn)/i.test(file) && file.endsWith(".node")) return true;
      if (!/\.(js|mjs|cjs)$/.test(file)) return false;
      return readFileSync(file, "utf8").includes("@vgpu/adapter-node");
    });
    expect(offenders.map((file) => path.relative(DOCS_ROOT, file))).toEqual([]);
  });

  it("reports the server bundle size so a regression is visible in CI logs", () => {
    const total = walk(SERVER_DIR)
      .map((file) => statSync(file).size)
      .reduce((sum, size) => sum + size, 0);
    console.info(`docs server bundle: ${(total / 1_000_000).toFixed(1)}MB`);
    expect(total).toBeGreaterThan(0);
  });
});
