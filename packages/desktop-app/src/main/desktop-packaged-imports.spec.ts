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
          "  - node_modules/@scope/core/package.json",
          "  - node_modules/@scope/core/dist/**",
          "asarUnpack:",
          "  - node_modules/unpacked-only/prebuilds/**",
          "mac:",
          "  files:",
          '    - "!node_modules/ws/build/**"',
          "",
        ].join("\n"),
      ),
    ).toEqual(new Set(["ws", "@scope/core"]));
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
      walk: (specifier) =>
        specifier.startsWith("@scope/core/")
          ? join(core, `${specifier.slice("@scope/core/".length)}.js`)
          : null,
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
        chain: [
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
    ).toEqual([{ specifier: "ws", chain: [] }]);
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
      { specifier: "left-pad", chain: ["@scope/core/a"] },
    ]);
  });
});
