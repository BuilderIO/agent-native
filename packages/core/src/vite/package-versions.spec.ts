import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveAgentNativePackageVersions } from "./package-versions.js";

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function writePackage(packageDir: string, manifest: Record<string, unknown>) {
  writeJson(path.join(packageDir, "package.json"), manifest);
  fs.writeFileSync(path.join(packageDir, "index.js"), "module.exports = {};\n");
}

describe("Agent-Native package version resolution", () => {
  it("resolves transitive packages from the package that declares them", () => {
    const appDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "agent-native-package-versions-"),
    );

    try {
      writeJson(path.join(appDir, "package.json"), {
        name: "fixture-app",
        dependencies: { "@agent-native/core": "0.1.0" },
      });
      writePackage(path.join(appDir, "node_modules/@agent-native/core"), {
        name: "@agent-native/core",
        version: "0.1.0",
        main: "index.js",
        dependencies: { "@agent-native/toolkit": "0.2.0" },
      });
      writePackage(
        path.join(
          appDir,
          "node_modules/@agent-native/core/node_modules/@agent-native/toolkit",
        ),
        {
          name: "@agent-native/toolkit",
          version: "0.2.0",
          main: "index.js",
        },
      );

      expect(resolveAgentNativePackageVersions(appDir)).toEqual({
        "@agent-native/core": "0.1.0",
        "@agent-native/toolkit": "0.2.0",
      });
    } finally {
      fs.rmSync(appDir, { recursive: true, force: true });
    }
  });
});
