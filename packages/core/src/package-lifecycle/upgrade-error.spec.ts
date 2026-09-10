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

  it("renders manifest symbol overrides in runtime and type messages", () => {
    const source = renderTombstoneModule({
      from: "@agent-native/core/client/editor",
      manifest: {
        sinceVersion: "0.111.0",
        moves: {
          "@agent-native/core/client/editor": {
            to: "@agent-native/toolkit/editor",
            symbols: {
              SharedRichEditor: "SharedRichEditor",
              RegistryBlockDataProvider: {
                to: "@agent-native/core/blocks",
              },
              uploadEditorImage: {
                to: "@agent-native/core/client/uploads",
              },
            },
          },
        },
      },
      helperImport: "../../package-lifecycle/upgrade-error.js",
      valueExports: [
        "SharedRichEditor",
        "RegistryBlockDataProvider",
        "uploadEditorImage",
      ],
    });

    expect(source).toContain(
      'throwMovedAgentNativeModule("@agent-native/core/client/editor", "@agent-native/toolkit/editor", {"RegistryBlockDataProvider":"@agent-native/core/blocks","uploadEditorImage":"@agent-native/core/client/uploads"})',
    );
    expect(source).toContain(
      `DeprecatedExport<"@agent-native/core/client/editor moved to @agent-native/core/blocks. Run: ${AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND}">`,
    );
    expect(source).toContain(
      `DeprecatedExport<"@agent-native/core/client/editor moved to @agent-native/core/client/uploads. Run: ${AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND}">`,
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

  it("gives agents exact symbol destinations for split modules", () => {
    const error = new AgentNativeUpgradeError(
      "@agent-native/core/client/editor",
      "@agent-native/toolkit/editor",
      {
        uploadEditorImage: "@agent-native/core/client/uploads",
        RegistryBlockDataProvider: "@agent-native/core/blocks",
      },
    );
    expect(error.message).toBe(
      `@agent-native/core/client/editor exports moved to multiple entrypoints: RegistryBlockDataProvider -> @agent-native/core/blocks; uploadEditorImage -> @agent-native/core/client/uploads; all other exports -> @agent-native/toolkit/editor. Run: ${AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND}`,
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

  it("keeps the shipped editor tombstone error in a minified bundle", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-editor-tombstone-"));
    roots.push(root);
    const output = path.join(root, "bundle.mjs");

    await build({
      entryPoints: [
        fileURLToPath(
          new URL("../client/tombstone/editor.ts", import.meta.url),
        ),
      ],
      outfile: output,
      bundle: true,
      format: "esm",
      platform: "node",
      minify: true,
    });

    const execution = spawnSync(process.execPath, [output], {
      encoding: "utf-8",
    });
    expect(execution.status).not.toBe(0);
    expect(execution.stderr).toContain(
      "RegistryBlockDataProvider -> @agent-native/core/blocks",
    );
    expect(execution.stderr).toContain(
      "uploadEditorImage -> @agent-native/core/client/uploads",
    );
    expect(execution.stderr).toContain(
      `all other exports -> @agent-native/toolkit/editor. Run: ${AGENT_NATIVE_UPGRADE_CODEMOD_COMMAND}`,
    );
  });
});
