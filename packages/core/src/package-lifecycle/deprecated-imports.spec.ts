import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanDeprecatedImports } from "./deprecated-imports.js";
import {
  bundledCoreMigrationManifestPath,
  isMigrationManifestActive,
  readMigrationManifest,
  resolveMigrationSymbolMove,
  type MigrationManifest,
} from "./migration-manifest.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("scanDeprecatedImports", () => {
  it("activates predictive moves only when their release is running", () => {
    const manifest: MigrationManifest = {
      sinceVersion: "0.111.0",
      moves: {},
    };
    expect(isMigrationManifestActive(manifest, "0.110.9")).toBe(false);
    expect(isMigrationManifestActive(manifest, "0.111.0")).toBe(true);
    expect(isMigrationManifestActive(manifest, "0.112.0")).toBe(true);
  });

  it("keeps the prepublished composer move planned", () => {
    const manifest = readMigrationManifest(bundledCoreMigrationManifestPath());
    expect(manifest).not.toBeNull();
    expect(manifest?.moves["@agent-native/core/client/composer"]?.status).toBe(
      "planned",
    );
    const clientMove = manifest?.moves["@agent-native/core/client"];
    expect(clientMove).toBeDefined();
    expect(
      clientMove
        ? resolveMigrationSymbolMove(clientMove, "PromptComposer")?.status
        : null,
    ).toBe("planned");
  });

  it("keeps editor adapters planned until Toolkit exports them", () => {
    const manifest = readMigrationManifest(bundledCoreMigrationManifestPath());
    const clientMove = manifest?.moves["@agent-native/core/client"];
    const adapterSymbols = [
      "uploadEditorImage",
      "createRegistryBlockNode",
      "RegistryBlockNodeView",
      "RegistryBlockDataProvider",
      "useRegistryBlockData",
      "CreateRegistryBlockNodeOptions",
      "RegistryBlockDataValue",
      "RegistryBlockSideMapBlock",
      "buildRegistryBlockSlashItems",
      "getRegistryBlockSlashDescription",
      "getRegistryBlockSlashSearchText",
      "BuildRegistryBlockSlashItemsOptions",
    ];

    expect(manifest?.moves["@agent-native/core/client/editor"]?.status).toBe(
      "planned",
    );
    expect(
      manifest?.moves["@agent-native/core/client/rich-markdown-editor"]?.status,
    ).toBe("planned");
    expect(clientMove).toBeDefined();
    for (const symbol of adapterSymbols) {
      expect(
        clientMove
          ? resolveMigrationSymbolMove(clientMove, symbol)?.status
          : null,
      ).toBe("planned");
    }
  });

  it("reports only symbols covered by the manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-doctor-moves-"));
    roots.push(root);
    fs.writeFileSync(
      path.join(root, "index.ts"),
      [
        'import { Kept, Moved } from "@agent-native/core/client";',
        'export { DeepMoved } from "@agent-native/core/client/legacy";',
        "",
      ].join("\n"),
    );
    const manifest: MigrationManifest = {
      sinceVersion: "0.110.0",
      moves: {
        "@agent-native/core/client": {
          to: "@agent-native/core/client/hooks",
          symbols: {
            Moved: { to: "@agent-native/core/client/agent-chat" },
          },
        },
        "@agent-native/core/client/legacy": {
          to: "@agent-native/toolkit/new-home",
        },
      },
    };

    expect(scanDeprecatedImports({ root, manifests: [manifest] })).toEqual([
      expect.objectContaining({
        line: 1,
        from: "@agent-native/core/client",
        to: ["@agent-native/core/client/agent-chat"],
        symbols: ["Moved"],
      }),
      expect.objectContaining({
        line: 2,
        from: "@agent-native/core/client/legacy",
        to: ["@agent-native/toolkit/new-home"],
        symbols: ["DeepMoved"],
      }),
    ]);
  });
});
