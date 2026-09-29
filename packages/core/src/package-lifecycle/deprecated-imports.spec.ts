import fs from "node:fs";
import { Module } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { scanDeprecatedImports } from "./deprecated-imports.js";
import {
  bundledCoreMigrationManifestPath,
  isMigrationManifestActive,
  loadMigrationManifestsForProject,
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

describe("loadMigrationManifestsForProject", () => {
  it("allows an absent optional Toolkit package", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-doctor-no-toolkit-"),
    );
    roots.push(root);
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "doctor-no-toolkit" }),
    );
    const resolveFilename = Module._resolveFilename;
    const resolveSpy = vi
      .spyOn(Module, "_resolveFilename")
      .mockImplementation((request, parent, isMain, options) => {
        if (request.startsWith("@agent-native/toolkit")) {
          throw Object.assign(new Error("Cannot find module"), {
            code: "MODULE_NOT_FOUND",
          });
        }
        return resolveFilename.call(Module, request, parent, isMain, options);
      });

    try {
      expect(loadMigrationManifestsForProject(root)).toHaveLength(1);
    } finally {
      resolveSpy.mockRestore();
    }
  });

  it("fails when an installed Toolkit has no resolvable migration manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-doctor-toolkit-"));
    roots.push(root);
    const toolkit = path.join(root, "node_modules/@agent-native/toolkit");
    fs.mkdirSync(toolkit, { recursive: true });
    fs.writeFileSync(
      path.join(toolkit, "package.json"),
      JSON.stringify({
        name: "@agent-native/toolkit",
        exports: {
          ".": "./index.js",
          "./migration-manifest.json": "./migration-manifest.json",
        },
      }),
    );
    fs.writeFileSync(path.join(toolkit, "index.js"), "");

    expect(() => loadMigrationManifestsForProject(root)).toThrow(
      /could not resolve.*installed/i,
    );
  });

  it("fails when the required bundled Core manifest is missing", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-doctor-core-manifest-"),
    );
    roots.push(root);
    const readFile = vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });

    try {
      expect(() => loadMigrationManifestsForProject(root)).toThrow(
        /required bundled Core migration manifest is missing/i,
      );
    } finally {
      readFile.mockRestore();
    }
  });
});

describe("scanDeprecatedImports", () => {
  it("documents removed AgentKit chat exports in their migration guide", () => {
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
      Object.values(manifest.removedExports ?? {})
        .filter((removedExport) =>
          removedExport.migrationGuide.endsWith("/agentkit-chat.md"),
        )
        .flatMap((removedExport) =>
          removedExport.symbols.filter(
            (symbol) => !removedExport.symbolGuides?.[symbol],
          ),
        ),
    );

    expect(
      [...symbols].filter((symbol) => !guide.includes(`\`${symbol}\``)),
    ).toEqual([]);
  });

  it("uses the per-symbol guide for removals sharing an old subpath", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-doctor-guides-"));
    roots.push(root);
    fs.writeFileSync(
      path.join(root, "index.ts"),
      [
        'import { createAgentChatAdapter } from "@agent-native/core/client/agent-chat";',
        'import { AgentNative } from "@agent-native/core/client";',
        "",
      ].join("\n"),
    );
    const manifest: MigrationManifest = {
      sinceVersion: "0.110.0",
      moves: {},
      removedExports: {
        "@agent-native/core/client/agent-chat": {
          symbols: ["createAgentChatAdapter"],
          migrationGuide: "https://example.test/agentkit-chat.md",
        },
        "@agent-native/core/client": {
          symbols: ["AgentNative"],
          migrationGuide: "https://example.test/agentkit-chat.md",
          symbolGuides: {
            AgentNative: "https://example.test/upgrading-core-ui.mdx",
          },
        },
      },
    };

    expect(scanDeprecatedImports({ root, manifests: [manifest] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "@agent-native/core/client/agent-chat",
          symbols: ["createAgentChatAdapter"],
          migrationGuide: "https://example.test/agentkit-chat.md",
        }),
        expect.objectContaining({
          from: "@agent-native/core/client",
          symbols: ["AgentNative"],
          migrationGuide: "https://example.test/upgrading-core-ui.mdx",
        }),
      ]),
    );
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

  it("routes root-barrel composer symbols to Toolkit", () => {
    const manifest = readMigrationManifest(bundledCoreMigrationManifestPath());
    expect(manifest).not.toBeNull();
    expect(manifest?.sinceVersion).toBe("0.110.0");
    expect(manifest?.moves["@agent-native/core/client/composer"]).toMatchObject(
      {
        to: "@agent-native/toolkit/app/chat/composer/index",
      },
    );
    const clientMove = manifest?.moves["@agent-native/core/client"];
    expect(clientMove).toBeDefined();
    expect(
      clientMove
        ? resolveMigrationSymbolMove(clientMove, "PromptComposer")
        : null,
    ).toMatchObject({
      to: "@agent-native/toolkit/app/chat",
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
        to: "@agent-native/toolkit/app/blocks",
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

  it("reports active moves in dynamic, CommonJS, namespace, and unquoted CSS imports", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-doctor-call-moves-"),
    );
    roots.push(root);
    fs.writeFileSync(
      path.join(root, "consumer.ts"),
      [
        'const { AgentSidebar } = await import("@agent-native/core/client");',
        'const { AppProvidersProps } = require("@agent-native/core/client/hooks");',
        'const client = await import("@agent-native/core/client");',
        "void client.AgentSidebar;",
        'require("@agent-native/core/client/AgentSidebar");',
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(root, "global.css"),
      "@import url(@agent-native/core/styles/agent-native.css);\n",
    );
    const manifest: MigrationManifest = {
      sinceVersion: "0.110.0",
      moves: {
        "@agent-native/core/client": {
          to: "@agent-native/core/client",
          symbols: {
            AgentSidebar: { to: "@agent-native/toolkit/app/chat/AgentSidebar" },
          },
        },
        "@agent-native/core/client/hooks": {
          to: "@agent-native/core/client/hooks",
          symbols: {
            AppProvidersProps: { to: "@agent-native/toolkit/app/providers" },
          },
        },
        "@agent-native/core/client/AgentSidebar": {
          to: "@agent-native/toolkit/app/chat/AgentSidebar",
        },
        "@agent-native/core/styles/agent-native.css": {
          to: "@agent-native/toolkit/styles.css",
        },
      },
    };

    expect(scanDeprecatedImports({ root, manifests: [manifest] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: path.join(root, "consumer.ts"),
          line: 1,
          from: "@agent-native/core/client",
          to: ["@agent-native/toolkit/app/chat/AgentSidebar"],
          symbols: ["AgentSidebar"],
        }),
        expect.objectContaining({
          file: path.join(root, "consumer.ts"),
          line: 2,
          from: "@agent-native/core/client/hooks",
          to: ["@agent-native/toolkit/app/providers"],
          symbols: ["AppProvidersProps"],
        }),
        expect.objectContaining({
          file: path.join(root, "consumer.ts"),
          line: 4,
          from: "@agent-native/core/client",
          to: ["@agent-native/toolkit/app/chat/AgentSidebar"],
          symbols: ["AgentSidebar"],
        }),
        expect.objectContaining({
          file: path.join(root, "consumer.ts"),
          line: 5,
          from: "@agent-native/core/client/AgentSidebar",
          to: ["@agent-native/toolkit/app/chat/AgentSidebar"],
        }),
        expect.objectContaining({
          file: path.join(root, "global.css"),
          line: 1,
          from: "@agent-native/core/styles/agent-native.css",
          to: ["@agent-native/toolkit/styles.css"],
        }),
      ]),
    );
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
        `(await import("${moduleName}"))?.["createAgentChatAdapter"]?.();`,
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
      [1, 2, 3, 4].map((line) =>
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

  it("reports TypeScript import-type references to removed chat exports", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-doctor-import-type-"),
    );
    roots.push(root);
    const moduleName = "@agent-native/core/client/agent-chat";
    const file = path.join(root, "consumer.ts");
    fs.writeFileSync(
      file,
      `type Options = import("${moduleName}").CreateAgentChatAdapterOptions;`,
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
                symbols: ["CreateAgentChatAdapterOptions"],
                migrationGuide: "https://example.test/agentkit-chat.md",
              },
            },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        file,
        line: 1,
        from: moduleName,
        symbols: ["CreateAgentChatAdapterOptions"],
        status: "removed",
      }),
    ]);
  });

  it("reports promise-chained function callbacks with commented imports", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-doctor-import-function-callback-"),
    );
    roots.push(root);
    const moduleName = "@agent-native/core/client/agent-chat";
    const file = path.join(root, "consumer.ts");
    fs.writeFileSync(
      file,
      [
        `import(/* webpackChunkName: "agent-chat" */ "${moduleName}").then(function (chat) { chat.createAgentChatAdapter(); });`,
        `import(/* chunk */ "${moduleName}").then(function ({ createAgentChatAdapter }) { createAgentChatAdapter(); });`,
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
      [1, 2].map((line) =>
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

  it("reports JSDoc import types in checked JavaScript without matching examples", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-doctor-jsdoc-type-"),
    );
    roots.push(root);
    const moduleName = "@agent-native/core/client/agent-chat";
    const file = path.join(root, "consumer.js");
    fs.writeFileSync(
      file,
      [
        `/** @type {import("${moduleName}").CreateAgentChatAdapterOptions} */`,
        "let options;",
        `/** Example: import("${moduleName}").CreateAgentChatAdapterOptions */`,
        `const example = '/** @type {import("${moduleName}").CreateAgentChatAdapterOptions} */';`,
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
                symbols: ["CreateAgentChatAdapterOptions"],
                migrationGuide: "https://example.test/agentkit-chat.md",
              },
            },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        file,
        line: 1,
        from: moduleName,
        symbols: ["CreateAgentChatAdapterOptions"],
        status: "removed",
      }),
    ]);
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
        "for (const chat of []) chat.createAgentChatAdapter();",
        "function propertyChain() { other.chat.createAgentChatAdapter(); }",
        "values.map((chat: unknown) => chat.createAgentChatAdapter());",
        "const arrowShadow = (chat: unknown) => { chat.createAgentChatAdapter(); };",
        "values.map(chat => chat.createAgentChatAdapter());",
        "function functionShadow() { function chat() {} chat.createAgentChatAdapter(); }",
        "function classShadow() { class chat {} chat.createAgentChatAdapter(); }",
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
        line: 13,
        from: moduleName,
        symbols: ["createAgentChatAdapter"],
        status: "removed",
      }),
    ]);
  });

  it("reports optional direct require access to removed chat exports", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-doctor-require-opt-"),
    );
    roots.push(root);
    const moduleName = "@agent-native/core/client/agent-chat";
    const file = path.join(root, "consumer.cjs");
    fs.writeFileSync(
      file,
      [
        `require("${moduleName}")?.createAgentChatAdapter?.();`,
        `require("${moduleName}")?.["createAgentChatAdapter"]?.();`,
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
      [1, 2].map((line) =>
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
      expect(() => readMigrationManifest(manifestPath)).toThrow(
        /Invalid migration manifest.*dependencies/,
      );
    }

    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ ...base, dependencies: {} }),
    );
    expect(() => readMigrationManifest(manifestPath)).toThrow(
      /Invalid migration manifest.*dependencies/,
    );
  });

  it("rejects malformed move and removed-export records before scanning", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-migration-shapes-"));
    roots.push(root);
    const manifestPath = path.join(root, "migration-manifest.json");
    const base = { sinceVersion: "0.111.0", moves: {} };

    for (const [manifest, field] of [
      [{ ...base, moves: null }, "moves"],
      [{ ...base, moves: { "@agent-native/core/client": null } }, "moves"],
      [{ ...base, removedExports: null }, "removedExports"],
      [
        {
          ...base,
          removedExports: {
            "@agent-native/core/client": {
              symbols: "createAgentChatAdapter",
              migrationGuide: "https://example.test/guide.md",
            },
          },
        },
        "removedExports",
      ],
      [
        {
          ...base,
          removedExports: {
            "@agent-native/core/client": {
              symbols: ["AgentNative"],
              migrationGuide: "https://example.test/guide.md",
              symbolGuides: {
                Unknown: "https://example.test/other.md",
              },
            },
          },
        },
        "removedExports",
      ],
    ] as const) {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      expect(() => readMigrationManifest(manifestPath)).toThrow(
        new RegExp(`Invalid migration manifest.*${field}`),
      );
    }
  });

  it("returns null only when the optional manifest file is absent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-missing-manifest-"));
    roots.push(root);
    expect(readMigrationManifest(path.join(root, "missing.json"))).toBeNull();
  });

  it("keeps the feature dependency records in the bundled Core manifest", () => {
    const manifest = readMigrationManifest(bundledCoreMigrationManifestPath());
    expect(manifest?.dependencies).toEqual(featureDependencies);
  });
});
