import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyTemplateLayer,
  createLayerPatch,
  readTemplateLayer,
} from "./template-layer.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-template-layer-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(root: string, files: Record<string, string>): string {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
}

const routeV1 = [
  "import { Shell } from './shell';",
  "",
  "export default function Home() {",
  '  return <Shell title="Chat" />;',
  "}",
  "",
].join("\n");
const routeStarter = routeV1.replace('title="Chat"', 'title="Your app here"');

function layer(files: Record<string, string> = {}): string {
  return write(path.join(tmpDir, "layer"), {
    "template-layer.json": JSON.stringify({
      base: "chat",
      delete: ["app/routes/settings.tsx"],
    }),
    "package.json": JSON.stringify({
      scripts: { "db:migrate": "drizzle-kit migrate" },
    }),
    "app/routes/_index.tsx.patch": createLayerPatch(
      "app/routes/_index.tsx",
      routeV1,
      routeStarter,
    ),
    "drizzle/schema.ts": "export {};\n",
    ...files,
  });
}

function base(route = routeV1): string {
  const dir = write(path.join(tmpDir, "base"), {
    "package.json": JSON.stringify({
      name: "chat",
      scripts: { dev: "agent-native dev" },
    }),
    "app/routes/_index.tsx": route,
    "app/routes/settings.tsx": "export {};\n",
    "AGENTS.md": "# Chat\n",
  });
  fs.symlinkSync("AGENTS.md", path.join(dir, "CLAUDE.md"));
  return dir;
}

describe("applyTemplateLayer", () => {
  it("patches, adds, deletes, and merges package.json onto the base", () => {
    const layerDir = layer();
    const dest = base();

    applyTemplateLayer(layerDir, readTemplateLayer(layerDir)!, dest);

    expect(
      fs.readFileSync(path.join(dest, "app/routes/_index.tsx"), "utf-8"),
    ).toBe(routeStarter);
    expect(fs.existsSync(path.join(dest, "app/routes/settings.tsx"))).toBe(
      false,
    );
    expect(fs.readFileSync(path.join(dest, "drizzle/schema.ts"), "utf-8")).toBe(
      "export {};\n",
    );
    expect(
      JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf-8")),
    ).toEqual({
      name: "chat",
      scripts: { dev: "agent-native dev", "db:migrate": "drizzle-kit migrate" },
    });
  });

  it("keeps applying when the base changes away from the patched lines", () => {
    const layerDir = layer();
    const dest = base(
      `// added upstream\n\n\n\n${routeV1}export const meta = {};\n`,
    );

    applyTemplateLayer(layerDir, readTemplateLayer(layerDir)!, dest);

    const route = fs.readFileSync(
      path.join(dest, "app/routes/_index.tsx"),
      "utf-8",
    );
    expect(route).toContain("// added upstream");
    expect(route).toContain('title="Your app here"');
    expect(route).toContain("export const meta = {};");
  });

  it("fails loudly when the base changed the patched lines", () => {
    const layerDir = layer();
    const dest = base(routeV1.replace('title="Chat"', 'title="Chat v2"'));

    expect(() =>
      applyTemplateLayer(layerDir, readTemplateLayer(layerDir)!, dest),
    ).toThrow(/no longer applies to app\/routes\/_index\.tsx/);
  });

  it("refuses to replace a base file wholesale", () => {
    const layerDir = layer({ "AGENTS.md": "# App\n" });

    expect(() =>
      applyTemplateLayer(layerDir, readTemplateLayer(layerDir)!, base()),
    ).toThrow(/ship AGENTS\.md\.patch instead/);
  });

  it("replaces a base symlink without writing through it", () => {
    const layerDir = layer({ "CLAUDE.md": "Read AGENTS.md.\n" });
    const dest = base();

    applyTemplateLayer(layerDir, readTemplateLayer(layerDir)!, dest);

    expect(fs.lstatSync(path.join(dest, "CLAUDE.md")).isFile()).toBe(true);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf-8")).toBe(
      "# Chat\n",
    );
  });

  it("refuses delete paths outside the destination", () => {
    const layerDir = layer();
    const outside = write(path.join(tmpDir, "outside"), { "keep.txt": "x" });
    const dest = base();

    for (const entry of ["../outside", "", "/etc"]) {
      expect(() =>
        applyTemplateLayer(layerDir, { base: "chat", delete: [entry] }, dest),
      ).toThrow(/must name something inside the template/);
    }
    expect(fs.existsSync(path.join(outside, "keep.txt"))).toBe(true);
  });

  it("refuses delete paths that pass through a symlink out of the destination", () => {
    const layerDir = layer();
    const outside = write(path.join(tmpDir, "outside"), { "keep.txt": "x" });
    const dest = base();
    fs.symlinkSync(outside, path.join(dest, "link"));

    expect(() =>
      applyTemplateLayer(
        layerDir,
        { base: "chat", delete: ["link/keep.txt"] },
        dest,
      ),
    ).toThrow(/must name something inside the template/);
    expect(fs.existsSync(path.join(outside, "keep.txt"))).toBe(true);
  });

  it("refuses layer files and patches that pass through a symlink out of the destination", () => {
    const outside = write(path.join(tmpDir, "outside"), {
      "app/routes/_index.tsx": routeV1,
    });
    const dest = base();
    fs.symlinkSync(outside, path.join(dest, "link"));

    for (const rel of ["link/new.ts", "link/app/routes/_index.tsx.patch"]) {
      const layerDir = layer({
        [rel]: rel.endsWith(".patch")
          ? createLayerPatch("app/routes/_index.tsx", routeV1, routeStarter)
          : "export {};\n",
      });
      expect(() =>
        applyTemplateLayer(layerDir, readTemplateLayer(layerDir)!, dest, {
          only: "link",
        }),
      ).toThrow(/must name something inside the template/);
      fs.rmSync(layerDir, { recursive: true, force: true });
    }
    expect(fs.existsSync(path.join(outside, "new.ts"))).toBe(false);
    expect(
      fs.readFileSync(path.join(outside, "app/routes/_index.tsx"), "utf-8"),
    ).toBe(routeV1);
  });

  it("refuses to patch a base symlink that points out of the destination", () => {
    const outside = write(path.join(tmpDir, "outside"), {
      "_index.tsx": routeV1,
    });
    const dest = base();
    const route = path.join(dest, "app/routes/_index.tsx");
    fs.rmSync(route);
    fs.symlinkSync(path.join(outside, "_index.tsx"), route);
    const layerDir = layer();

    expect(() =>
      applyTemplateLayer(layerDir, readTemplateLayer(layerDir)!, dest),
    ).toThrow(/must name something inside the template/);
    expect(fs.readFileSync(path.join(outside, "_index.tsx"), "utf-8")).toBe(
      routeV1,
    );
  });

  it("limits itself to one subtree when asked", () => {
    const layerDir = layer();
    const dest = base();

    applyTemplateLayer(layerDir, readTemplateLayer(layerDir)!, dest, {
      only: "drizzle",
    });

    expect(fs.existsSync(path.join(dest, "drizzle/schema.ts"))).toBe(true);
    expect(
      fs.readFileSync(path.join(dest, "app/routes/_index.tsx"), "utf-8"),
    ).toBe(routeV1);
    expect(fs.existsSync(path.join(dest, "app/routes/settings.tsx"))).toBe(
      true,
    );
  });
});
