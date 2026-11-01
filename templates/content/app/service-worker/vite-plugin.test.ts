import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ReactRouterManifest } from "./shell-manifest";
import { createShellBuildFile, writeShellWorker } from "./vite-plugin";

const MANIFEST: ReactRouterManifest = {
  version: "ec4917e9",
  url: "/assets/manifest-ec4917e9.js",
  entry: { module: "/assets/entry.client-DYrOoKbv.js", imports: [] },
  routes: {
    root: { id: "root", path: "", module: "/assets/root-AAAAAAAA.js" },
    "routes/_app": { id: "routes/_app", parentId: "root" },
    "routes/_app.page.$id": {
      id: "routes/_app.page.$id",
      parentId: "routes/_app",
      path: "page/:id",
      module: "/assets/page-BBBBBBBB.js",
    },
  },
};
const FILES = [
  "/assets/manifest-ec4917e9.js",
  "/assets/entry.client-DYrOoKbv.js",
  "/assets/root-AAAAAAAA.js",
  "/assets/page-BBBBBBBB.js",
  "/assets/lazy/chart-CCCCCCCC.js",
];

const scratch: string[] = [];

function clientBuild(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "content-shell-build-"));
  scratch.push(dir);
  for (const file of FILES) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), "export {};");
  }
  fs.writeFileSync(
    path.join(dir, "assets/manifest-ec4917e9.js"),
    `window.__reactRouterManifest=${JSON.stringify(MANIFEST)};`,
  );
  return dir;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("the build file", () => {
  it("lists the boot files, every hashed file and the routes", () => {
    const file = createShellBuildFile(MANIFEST, [
      ...FILES,
      "/assets/sw-build-ec4917e9.json",
    ]);
    expect(file.version).toBe("ec4917e9");
    expect(file.boot).toEqual(FILES.slice(0, 4).sort());
    expect(file.assets).toEqual([...FILES].sort());
    expect(file.routes).toContainEqual({
      id: "routes/_app.page.$id",
      pattern: "/page/:id",
      app: true,
    });
  });

  it("fails the build when the manifest names a file the build lacks", () => {
    expect(() => createShellBuildFile(MANIFEST, FILES.slice(1))).toThrow(
      /manifest-ec4917e9\.js/,
    );
  });
});

describe("writing the worker", () => {
  it("writes one classic script and the build file", async () => {
    const dir = clientBuild();
    await writeShellWorker(dir, undefined);

    const script = fs.readFileSync(path.join(dir, "sw.js"), "utf8");
    expect(script).not.toMatch(/^\s*(import|export)\s/m);
    expect(script).toContain("content-shell:adopt");
    expect(script).toContain("respondWith");
    expect(script).toContain("addRoutes");
    const file = JSON.parse(
      fs.readFileSync(path.join(dir, "assets/sw-build-ec4917e9.json"), "utf8"),
    );
    expect(file.assets).toContain("/assets/lazy/chart-CCCCCCCC.js");
  }, 60_000);

  it("writes the same script for every build, so deploys don't reinstall it", async () => {
    const first = clientBuild();
    const second = clientBuild();
    await writeShellWorker(first, undefined);
    await writeShellWorker(second, undefined);
    expect(fs.readFileSync(path.join(first, "sw.js"), "utf8")).toBe(
      fs.readFileSync(path.join(second, "sw.js"), "utf8"),
    );
  }, 60_000);

  it("writes the self-removing worker and no build file when turned off", async () => {
    const dir = clientBuild();
    await writeShellWorker(dir, "off");
    const script = fs.readFileSync(path.join(dir, "sw.js"), "utf8");
    expect(script).toContain("unregister");
    expect(script).not.toContain("content-shell:adopt");
    expect(fs.existsSync(path.join(dir, "assets/sw-build-ec4917e9.json"))).toBe(
      false,
    );
  }, 60_000);
});
