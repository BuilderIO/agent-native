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
const featureDependencies = [
  {
    name: "@electric-sql/pglite",
    version: "^0.5.8",
    when: "pglite-database",
  },
  {
    name: "@sentry/node",
    version: "^10.60.0 || ^11.0.0",
    when: "server-sentry",
  },
  {
    name: "@sentry/browser",
    version: "^10.60.0 || ^11.0.0",
    when: "browser-sentry",
  },
  {
    name: "@sentry/vite-plugin",
    version: "^5.4.0",
    when: "sentry-source-map-upload",
  },
  { name: "@better-auth/sso", version: "1.7.4", when: "sso" },
  { name: "@better-auth/scim", version: "1.7.4", when: "scim" },
  {
    name: "@amplitude/analytics-browser",
    version: "^2.45.8",
    when: "amplitude",
  },
  {
    name: "botframework-connector",
    version: "^4.23.3",
    when: "microsoft-teams",
  },
];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("scanDeprecatedImports", () => {
  it("documents every removed export in the migration guide", () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        new URL("../../migration-manifest.json", import.meta.url),
        "utf-8",
      ),
    ) as MigrationManifest;
    const guide = fs.readFileSync(
      new URL("../../docs/migrations/agentkit-chat.md", import.meta.url),
      "utf-8",
    );
    const symbols = new Set(
      Object.values(manifest.removedExports ?? {}).flatMap(
        (removedExport) => removedExport.symbols,
      ),
    );

    expect(
      [...symbols].filter((symbol) => !guide.includes(`\`${symbol}\``)),
    ).toEqual([]);
  });

  it("activates predictive moves only when their release is running", () => {
    const manifest: MigrationManifest = {
      sinceVersion: "0.111.0",
      moves: {},
    };
    expect(isMigrationManifestActive(manifest, "0.110.9")).toBe(false);
    expect(isMigrationManifestActive(manifest, "0.111.0")).toBe(true);
    expect(isMigrationManifestActive(manifest, "0.112.0")).toBe(true);
  });

  it("activates the root-barrel move to the framework-wired composer entry", () => {
    const manifest = readMigrationManifest(bundledCoreMigrationManifestPath());
    expect(manifest).not.toBeNull();
    expect(manifest?.sinceVersion).toBe("0.110.0");
    expect(
      manifest?.moves["@agent-native/core/client/composer"],
    ).toBeUndefined();
    const clientMove = manifest?.moves["@agent-native/core/client"];
    expect(clientMove).toBeDefined();
    expect(
      clientMove
        ? resolveMigrationSymbolMove(clientMove, "PromptComposer")
        : null,
    ).toMatchObject({
      to: "@agent-native/core/client/composer",
      status: "active",
    });
  });

  it("activates the split editor adapter destinations", () => {
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
      undefined,
    );
    expect(
      manifest?.moves["@agent-native/core/client/rich-markdown-editor"]?.status,
    ).toBeUndefined();
    expect(clientMove).toBeDefined();
    for (const symbol of adapterSymbols) {
      expect(
        clientMove
          ? resolveMigrationSymbolMove(clientMove, symbol)?.status
          : null,
      ).toBe("active");
    }
    for (const specifier of [
      "@agent-native/core/client/editor",
      "@agent-native/core/client/rich-markdown-editor",
    ]) {
      const move = manifest?.moves[specifier];
      expect(move).toBeDefined();
      expect(
        move ? resolveMigrationSymbolMove(move, "RichMarkdownEditor") : null,
      ).toMatchObject({
        to: "@agent-native/toolkit/editor",
        status: "active",
      });
      expect(
        move ? resolveMigrationSymbolMove(move, "uploadEditorImage") : null,
      ).toMatchObject({
        to: "@agent-native/core/client/uploads",
        status: "active",
      });
      expect(
        move
          ? resolveMigrationSymbolMove(move, "RegistryBlockDataProvider")
          : null,
      ).toMatchObject({
        to: "@agent-native/core/blocks",
        status: "active",
      });
      expect(
        move
          ? resolveMigrationSymbolMove(move, "RegistryBlockDataProvider")
          : null,
      ).toMatchObject({
        to: "@agent-native/core/blocks",
        status: "active",
      });
    }
    const testingMove = manifest?.moves["@agent-native/core/testing"];
    expect(
      testingMove
        ? resolveMigrationSymbolMove(testingMove, "DragHandle")
        : null,
    ).toMatchObject({
      to: "@agent-native/toolkit/editor",
      status: "active",
    });
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

  it("reports removed chat exports with their migration guide", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-doctor-removed-"));
    roots.push(root);
    fs.writeFileSync(
      path.join(root, "index.js"),
      'import { createAgentChatAdapter, AssistantChat } from "@agent-native/core/client/agent-chat";\n',
    );

    expect(
      scanDeprecatedImports({
        root,
        manifests: [
          {
            sinceVersion: "0.110.0",
            moves: {},
            removedExports: {
              "@agent-native/core/client/agent-chat": {
                symbols: ["createAgentChatAdapter"],
                migrationGuide: "https://example.test/agentkit-chat.md",
              },
            },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        line: 1,
        from: "@agent-native/core/client/agent-chat",
        to: [],
        symbols: ["createAgentChatAdapter"],
        status: "removed",
        migrationGuide: "https://example.test/agentkit-chat.md",
      }),
    ]);
  });

  it("ignores removed import examples in test strings and comments", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-doctor-fixtures-"));
    roots.push(root);
    const file = path.join(root, "scanner.spec.ts");
    const moduleName = "@agent-native/core/client/agent-chat";
    fs.writeFileSync(
      file,
      [
        `const namedSnippet = 'import { createAgentChatAdapter } from "${moduleName}";';`,
        `const templateSnippet = \`import { createAgentChatAdapter } from "${moduleName}";\`;`,
        'const runtimeSnippet = `${require("@agent-native/core/client/agent-chat").createAgentChatAdapter}`;',
        'const namespaceSnippet = "chat.createAgentChatAdapter?.()";',
        `// import { createAgentChatAdapter } from "${moduleName}";`,
        `import * as chat from "${moduleName}";`,
        "chat.createAgentChatAdapter?.();",
        `import { createAgentChatAdapter } from "${moduleName}";`,
      ].join("\n"),
    );

    expect(
      scanDeprecatedImports({
        root,
        manifests: [
          {
            sinceVersion: "0.110.0",
            moves: {},
            removedExports: {
              [moduleName]: {
                symbols: ["createAgentChatAdapter"],
                migrationGuide: "https://example.test/agentkit-chat.md",
              },
            },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        file,
        line: 7,
        from: moduleName,
        symbols: ["createAgentChatAdapter"],
        status: "removed",
      }),
      expect.objectContaining({
        file,
        line: 8,
        from: moduleName,
        symbols: ["createAgentChatAdapter"],
        status: "removed",
      }),
      expect.objectContaining({
        file,
        line: 3,
        from: moduleName,
        symbols: ["createAgentChatAdapter"],
        status: "removed",
      }),
    ]);
  });

  it("ignores removed namespace examples in regex literals", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-doctor-regex-"));
    roots.push(root);
    const moduleName = "@agent-native/core/client/agent-chat";
    const file = path.join(root, "consumer.ts");
    fs.writeFileSync(
      file,
      [
        `import * as chat from "${moduleName}";`,
        String.raw`const pattern = /chat\.createAgentChatAdapter/;`,
        String.raw`if (enabled) /chat\.createAgentChatAdapter/.test(pattern);`,
        "chat.createAgentChatAdapter();",
      ].join("\n"),
    );

    expect(
      scanDeprecatedImports({
        root,
        manifests: [
          {
            sinceVersion: "0.110.0",
            moves: {},
            removedExports: {
              [moduleName]: {
                symbols: ["createAgentChatAdapter"],
                migrationGuide: "https://example.test/agentkit-chat.md",
              },
            },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        file,
        line: 4,
        symbols: ["createAgentChatAdapter"],
        status: "removed",
      }),
    ]);
  });

  it("reports removed chat exports through namespace and CommonJS imports", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-doctor-import-forms-"),
    );
    roots.push(root);
    const moduleName = "@agent-native/core/client/agent-chat";
    fs.writeFileSync(
      path.join(root, "consumer.mjs"),
      [
        `import * as chat from "${moduleName}";`,
        "chat?.createAgentChatAdapter?.();",
        "chat.AssistantChat;",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(root, "consumer-dynamic.mjs"),
      [
        `const { createAgentChatRuntimeAdapter: createRuntimeAdapter } = await import("${moduleName}");`,
        "createRuntimeAdapter();",
        `const chat = await import("${moduleName}");`,
        "chat?.createCodeAgentChatAdapter?.();",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(root, "consumer-promise.mjs"),
      [
        `import("${moduleName}").then(({ AssistantMessageActionBar }) => AssistantMessageActionBar);`,
        `import("${moduleName}").then((chatModule) => chatModule?.codeAgentTranscriptHasPendingApproval?.());`,
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(root, "consumer.cjs"),
      [
        `const { createAgentChatRuntimeAdapter: createRuntimeAdapter } = require("${moduleName}");`,
        "createRuntimeAdapter();",
        `const chat = require("${moduleName}");`,
        "chat.createCodeAgentChatAdapter();",
        `require("${moduleName}").codeAgentTranscriptHasPendingApproval();`,
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(root, "consumer.cts"),
      [
        `import chat = require("${moduleName}");`,
        "chat.AssistantMessageActionBar;",
      ].join("\n"),
    );

    const findings = scanDeprecatedImports({
      root,
      manifests: [
        {
          sinceVersion: "0.110.0",
          moves: {},
          removedExports: {
            [moduleName]: {
              symbols: [
                "createAgentChatAdapter",
                "createAgentChatRuntimeAdapter",
                "createCodeAgentChatAdapter",
                "codeAgentTranscriptHasPendingApproval",
                "AssistantMessageActionBar",
              ],
              migrationGuide: "https://example.test/agentkit-chat.md",
            },
          },
        },
      ],
    });

    expect(findings).toHaveLength(9);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: path.join(root, "consumer.mjs"),
          line: 2,
          symbols: ["createAgentChatAdapter"],
          status: "removed",
        }),
        expect.objectContaining({
          file: path.join(root, "consumer-dynamic.mjs"),
          line: 1,
          symbols: ["createAgentChatRuntimeAdapter"],
          status: "removed",
        }),
        expect.objectContaining({
          file: path.join(root, "consumer-promise.mjs"),
          line: 1,
          symbols: ["AssistantMessageActionBar"],
          status: "removed",
        }),
        expect.objectContaining({
          file: path.join(root, "consumer-promise.mjs"),
          line: 2,
          symbols: ["codeAgentTranscriptHasPendingApproval"],
          status: "removed",
        }),
        expect.objectContaining({
          file: path.join(root, "consumer-dynamic.mjs"),
          line: 4,
          symbols: ["createCodeAgentChatAdapter"],
          status: "removed",
        }),
        expect.objectContaining({
          file: path.join(root, "consumer.cjs"),
          line: 1,
          symbols: ["createAgentChatRuntimeAdapter"],
          status: "removed",
        }),
        expect.objectContaining({
          file: path.join(root, "consumer.cjs"),
          line: 4,
          symbols: ["createCodeAgentChatAdapter"],
          status: "removed",
        }),
        expect.objectContaining({
          file: path.join(root, "consumer.cjs"),
          line: 5,
          symbols: ["codeAgentTranscriptHasPendingApproval"],
          status: "removed",
        }),
        expect.objectContaining({
          file: path.join(root, "consumer.cts"),
          line: 2,
          symbols: ["AssistantMessageActionBar"],
          status: "removed",
        }),
      ]),
    );
  });

  it("reports direct dynamic-import access to removed chat exports", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-doctor-dynamic-member-"),
    );
    roots.push(root);
    const moduleName = "@agent-native/core/client/agent-chat";
    const file = path.join(root, "consumer.mjs");
    fs.writeFileSync(
      file,
      [
        `(await import("${moduleName}")).createAgentChatAdapter();`,
        `(await import("${moduleName}"))?.createAgentChatAdapter?.();`,
        `(await import("${moduleName}"))["createAgentChatAdapter"]();`,
        `object.import("${moduleName}").createAgentChatAdapter();`,
        `notimport("${moduleName}").createAgentChatAdapter();`,
        `import("${moduleName}").createAgentChatAdapter();`,
        `await import("${moduleName}").createAgentChatAdapter();`,
      ].join("\n"),
    );

    expect(
      scanDeprecatedImports({
        root,
        manifests: [
          {
            sinceVersion: "0.110.0",
            moves: {},
            removedExports: {
              [moduleName]: {
                symbols: ["createAgentChatAdapter"],
                migrationGuide: "https://example.test/agentkit-chat.md",
              },
            },
          },
        ],
      }),
    ).toEqual(
      [1, 2, 3].map((line) =>
        expect.objectContaining({
          file,
          line,
          from: moduleName,
          symbols: ["createAgentChatAdapter"],
          status: "removed",
        }),
      ),
    );
  });

  it("ignores removed namespace members shadowed by local bindings", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-doctor-shadowed-"));
    roots.push(root);
    const moduleName = "@agent-native/core/client/agent-chat";
    const file = path.join(root, "consumer.ts");
    fs.writeFileSync(
      file,
      [
        `import * as chat from "${moduleName}";`,
        "function parameterShadow(chat: unknown) { chat.createAgentChatAdapter(); }",
        "function localShadow() { const chat = {}; chat.createAgentChatAdapter(); }",
        "function blockShadow() { { let chat = {}; chat.createAgentChatAdapter(); } }",
        "function loopShadow() { for (const chat of []) { chat.createAgentChatAdapter(); } }",
        "const arrowShadow = (chat: unknown) => { chat.createAgentChatAdapter(); };",
        "chat.createAgentChatAdapter();",
      ].join("\n"),
    );

    expect(
      scanDeprecatedImports({
        root,
        manifests: [
          {
            sinceVersion: "0.110.0",
            moves: {},
            removedExports: {
              [moduleName]: {
                symbols: ["createAgentChatAdapter"],
                migrationGuide: "https://example.test/agentkit-chat.md",
              },
            },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        file,
        line: 7,
        from: moduleName,
        symbols: ["createAgentChatAdapter"],
        status: "removed",
      }),
    ]);
  });
});

describe("readMigrationManifest dependencies", () => {
  it("accepts known dependency conditions and rejects malformed records", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-migration-deps-"));
    roots.push(root);
    const manifestPath = path.join(root, "migration-manifest.json");
    const base = { sinceVersion: "0.111.0", moves: {} };

    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ ...base, dependencies: featureDependencies }),
    );
    expect(readMigrationManifest(manifestPath)?.dependencies).toEqual(
      featureDependencies,
    );

    for (const invalid of [
      null,
      {},
      { name: "", version: "^1.0.0", when: "sso" },
      { name: "pkg", version: "", when: "sso" },
      { name: "pkg", version: "^1.0.0", when: "unknown" },
      { name: "pkg", version: "^1.0.0", when: 1 },
    ]) {
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({ ...base, dependencies: [invalid] }),
      );
      expect(readMigrationManifest(manifestPath)).toBeNull();
    }

    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ ...base, dependencies: {} }),
    );
    expect(readMigrationManifest(manifestPath)).toBeNull();
  });

  it("keeps the feature dependency records in the bundled Core manifest", () => {
    const manifest = readMigrationManifest(bundledCoreMigrationManifestPath());
    expect(manifest?.dependencies).toEqual(featureDependencies);
  });
});
