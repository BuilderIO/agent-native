import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findUnpackagedImports,
  packagedModuleNames,
} from "../../packaged-imports";

describe("packagedModuleNames", () => {
  it("reads the packages electron-builder keeps from node_modules", () => {
    expect(
      packagedModuleNames(
        [
          "appId: com.example",
          "files:",
          "  - out/**",
          '  - "!node_modules/**"',
          "  - node_modules/ws/**",
          "",
          "# A comment at the margin",
          "  # and one in the list",
          '  - "node_modules/quoted/**"',
          "  - node_modules/@scope/core/package.json",
          "  - node_modules/@scope/core/dist/**",
          "  - node_modules/metadata-only/package.json",
          "asarUnpack:",
          "  - node_modules/unpacked-only/prebuilds/**",
          "mac:",
          "  files:",
          '    - "!node_modules/ws/build/**"',
          "",
        ].join("\n"),
      ),
    ).toEqual(new Set(["ws", "quoted", "@scope/core"]));
  });
});

describe("findUnpackagedImports", () => {
  let core: string;

  function write(file: string, source: string) {
    const target = join(core, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }

  function find(specifiers: string[], packaged: string[]) {
    return findUnpackagedImports({
      specifiers,
      packaged: new Set(packaged),
      readImportsOf: "@scope/core",
      resolveFile: (specifier) =>
        join(core, `${specifier.slice("@scope/core/".length) || "index"}.js`),
    });
  }

  beforeEach(() => {
    core = mkdtempSync(join(tmpdir(), "desktop-packaged-imports-"));
  });

  afterEach(() => {
    rmSync(core, { recursive: true, force: true });
  });

  it("reports a package only a nested core module imports, with the path to it", () => {
    write("cli/agent-plugin.js", 'import { url } from "../mcp/remote-url.js";');
    write("mcp/remote-url.js", 'export * from "../config/schema.js";');
    write(
      "config/schema.js",
      'import fs from "node:fs";\nimport { z } from "zod";\nexport const schema = z;',
    );

    expect(
      find(["@scope/core/cli/agent-plugin"], ["@scope/core", "ws"]),
    ).toEqual([
      {
        specifier: "zod",
        importedThrough: [
          "@scope/core/cli/agent-plugin",
          "../mcp/remote-url.js",
          "../config/schema.js",
        ],
      },
    ]);
    expect(
      find(["@scope/core/cli/agent-plugin"], ["@scope/core", "zod"]),
    ).toEqual([]);
  });

  it("reports a package the bundle imports directly, but not Electron or Node's own", () => {
    expect(
      find(["electron", "electron/main", "path", "node:fs", "ws"], ["zod"]),
    ).toEqual([{ specifier: "ws", importedThrough: [] }]);
  });

  it("reads the imports of the package's own entry point", () => {
    write("index.js", 'export * from "./server/index.js";');
    write("server/index.js", 'import "h3";');

    expect(find(["@scope/core"], ["@scope/core"])).toEqual([
      { specifier: "h3", importedThrough: ["@scope/core", "server/index.js"] },
    ]);
  });

  it("ignores type-like text and imports that only run on demand", () => {
    write(
      "template.js",
      'export const example = `import { z } from "zod";`;\nexport const load = () => import("h3");',
    );

    expect(find(["@scope/core/template"], ["@scope/core"])).toEqual([]);
  });

  it("reads modules that import each other once", () => {
    write("a.js", 'import "./b.js";\nimport "left-pad";');
    write("b.js", 'import "./a.js";\nimport "left-pad/sub";');

    expect(find(["@scope/core/a"], ["@scope/core"])).toEqual([
      { specifier: "left-pad", importedThrough: ["@scope/core/a"] },
    ]);
  });
});
