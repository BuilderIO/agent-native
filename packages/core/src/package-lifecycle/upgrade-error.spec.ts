import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { afterEach, describe, expect, it } from "vitest";

import { AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND } from "./migration-message.js";
import { renderTombstoneModule } from "./tombstone.js";
import { AgentNativeUpgradeError } from "./upgrade-error.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("AgentNativeUpgradeError", () => {
  it("renders runtime and message-carrying type tombstones", () => {
    const source = renderTombstoneModule({
      from: "@agent-native/core/client/old",
      manifest: {
        sinceVersion: "0.111.0",
        moves: {
          "@agent-native/core/client/old": {
            to: "@agent-native/toolkit/new",
          },
        },
      },
      helperImport: "../../package-lifecycle/upgrade-error.js",
      valueExports: ["OldWidget"],
      typeExports: ["OldWidgetProps"],
    });
    expect(source).toContain(
      'throwMovedAgentNativeModule("@agent-native/core/client/old", "@agent-native/toolkit/new")',
    );
    expect(source).toContain(
      `DeprecatedExport<"@agent-native/core/client/old moved to @agent-native/toolkit/new. Run: ${AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND}">`,
    );
  });

  it("requires an exact manifest move before generating a tombstone", () => {
    expect(() =>
      renderTombstoneModule({
        from: "@agent-native/core/client/unknown",
        manifest: { sinceVersion: "0.111.0", moves: {} },
        helperImport: "../../package-lifecycle/upgrade-error.js",
      }),
    ).toThrow(/without an active exact migration manifest move/);
  });

  it("does not render a tombstone for a planned move", () => {
    expect(() =>
      renderTombstoneModule({
        from: "@agent-native/core/client/composer",
        manifest: {
          sinceVersion: "0.111.0",
          moves: {
            "@agent-native/core/client/composer": {
              to: "@agent-native/toolkit/composer",
              status: "planned",
            },
          },
        },
        helperImport: "../../package-lifecycle/upgrade-error.js",
      }),
    ).toThrow(/without an active exact migration manifest move/);
  });

  it("gives agents the exact one-command migration", () => {
    const error = new AgentNativeUpgradeError(
      "@agent-native/core/client/old",
      "@agent-native/toolkit/new",
    );
    expect(error.message).toBe(
      `@agent-native/core/client/old moved to @agent-native/toolkit/new. Run: ${AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND}`,
    );
  });

  it("survives a minified bundle when the tombstone is side-effect pinned", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-tombstone-"));
    roots.push(root);
    const packageRoot = path.join(root, "node_modules", "@fixture", "removed");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@fixture/removed",
        type: "module",
        exports: { ".": "./tombstone.js" },
        sideEffects: ["./tombstone.js"],
      }),
    );
    const helper = fileURLToPath(
      new URL("./upgrade-error.ts", import.meta.url),
    ).replaceAll("\\", "/");
    fs.writeFileSync(
      path.join(packageRoot, "tombstone.js"),
      [
        `import { throwMovedAgentNativeModule } from ${JSON.stringify(helper)};`,
        'throwMovedAgentNativeModule("@fixture/removed", "@fixture/new");',
        "export const Removed = undefined;",
      ].join("\n"),
    );
    const entry = path.join(root, "entry.ts");
    const output = path.join(root, "bundle.mjs");
    fs.writeFileSync(
      entry,
      'import { Removed } from "@fixture/removed";\nvoid Removed;\n',
    );

    await build({
      entryPoints: [entry],
      outfile: output,
      bundle: true,
      format: "esm",
      platform: "node",
      minify: true,
    });
    const bundled = fs.readFileSync(output, "utf-8");
    expect(bundled).toContain(AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND);
    const execution = spawnSync(process.execPath, [output], {
      encoding: "utf-8",
    });
    expect(execution.status).not.toBe(0);
    expect(execution.stderr).toContain(
      `@fixture/removed moved to @fixture/new. Run: ${AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND}`,
    );
  });
});
