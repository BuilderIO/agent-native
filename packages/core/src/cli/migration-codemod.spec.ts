import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { MigrationManifest } from "../package-lifecycle/migration-manifest.js";
import {
  createMigrationPlanningTargetResolver,
  formatMigrationCodemodDiff,
  runMigrationCodemods,
} from "./migration-codemod.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const manifest: MigrationManifest = {
  sinceVersion: "0.110.0",
  moves: {
    "@agent-native/core/client": {
      to: "@agent-native/core/client/hooks",
      symbols: {
        useActionQuery: "useActionQuery",
        AgentPanel: { to: "@agent-native/core/client/agent-chat" },
        AgentPanelProps: { to: "@agent-native/core/client/agent-chat" },
        OldWidget: { to: "@agent-native/toolkit/ui", name: "Widget" },
      },
    },
    "@agent-native/core/client/legacy": {
      to: "@agent-native/toolkit/new-home",
    },
  },
};

function fixture(): { root: string; source: string; packageFile: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-codemod-"));
  roots.push(root);
  const source = path.join(root, "src", "index.tsx");
  const packageFile = path.join(root, "package.json");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(
    packageFile,
    `${JSON.stringify(
      {
        name: "fixture",
        dependencies: { "@agent-native/core": "latest" },
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    source,
    [
      'import { AgentPanel, type AgentPanelProps, useActionQuery, OldWidget as LocalWidget } from "@agent-native/core/client";',
      'import legacy from "@agent-native/core/client/legacy";',
      'export { AgentPanel, OldWidget } from "@agent-native/core/client";',
      "void AgentPanel; void useActionQuery; void LocalWidget; void legacy;",
      "export type Props = AgentPanelProps;",
      "",
    ].join("\n"),
  );
  return { root, source, packageFile };
}

describe("runMigrationCodemods", () => {
  it("previews split imports, symbol renames, exports, and dependencies", () => {
    const { root, source, packageFile } = fixture();
    const before = fs.readFileSync(source, "utf-8");
    const result = runMigrationCodemods({
      root,
      manifests: [manifest],
      targetExists: () => true,
    });

    expect(result.changes.map((change) => change.file)).toEqual([
      source,
      packageFile,
    ]);
    expect(fs.readFileSync(source, "utf-8")).toBe(before);
    const diff = formatMigrationCodemodDiff(result, root);
    expect(diff).toContain("@agent-native/core/client/agent-chat");
    expect(diff).toContain("@agent-native/core/client/hooks");
    expect(diff).toContain("@agent-native/toolkit/ui");
    expect(diff).toContain('"@agent-native/toolkit": "latest"');
  });

  it("applies once and is idempotent", () => {
    const { root, source, packageFile } = fixture();
    const applied = runMigrationCodemods({
      root,
      manifests: [manifest],
      apply: true,
      targetExists: () => true,
    });
    expect(applied.changes).toHaveLength(2);

    const migrated = fs.readFileSync(source, "utf-8");
    expect(migrated).toContain('from "@agent-native/core/client/agent-chat"');
    expect(migrated).toContain('from "@agent-native/core/client/hooks"');
    expect(migrated).toContain("Widget as LocalWidget");
    expect(migrated).toContain("Widget as OldWidget");
    expect(migrated).toContain('legacy from "@agent-native/toolkit/new-home"');
    expect(
      JSON.parse(fs.readFileSync(packageFile, "utf-8")).dependencies,
    ).toMatchObject({ "@agent-native/toolkit": "latest" });

    expect(
      runMigrationCodemods({
        root,
        manifests: [manifest],
        apply: true,
        targetExists: () => true,
      }).changes,
    ).toEqual([]);
  });

  it("warns instead of guessing at a symbol-level namespace import", () => {
    const { root, source } = fixture();
    fs.writeFileSync(
      source,
      'import * as Client from "@agent-native/core/client";\nvoid Client;\n',
    );
    const result = runMigrationCodemods({
      root,
      manifests: [manifest],
      apply: true,
      targetExists: () => true,
    });
    expect(result.changes).toEqual([]);
    expect(result.warnings).toEqual([
      expect.stringContaining(
        "cannot split default, namespace, or side-effect",
      ),
    ]);
  });

  it("does not rewrite a planned composer move", () => {
    const { root, source } = fixture();
    const before =
      'import { PromptComposer } from "@agent-native/core/client";\nvoid PromptComposer;\n';
    fs.writeFileSync(source, before);

    const result = runMigrationCodemods({
      root,
      manifests: [
        {
          sinceVersion: "0.110.0",
          moves: {
            "@agent-native/core/client": {
              to: "@agent-native/core/client/hooks",
              symbols: {
                PromptComposer: {
                  to: "@agent-native/toolkit/composer",
                  status: "planned",
                },
              },
            },
          },
        },
      ],
      apply: true,
      targetExists: () => false,
    });

    expect(result.changes).toEqual([]);
    expect(fs.readFileSync(source, "utf-8")).toBe(before);
    expect(result.warnings).toEqual([
      expect.stringContaining("planned but not active"),
    ]);
  });

  it("skips an active move whose target is not installed", () => {
    const { root, source } = fixture();
    const before =
      'import { Legacy } from "@agent-native/core/client/legacy";\nvoid Legacy;\n';
    fs.writeFileSync(source, before);
    const result = runMigrationCodemods({
      root,
      manifests: [
        {
          sinceVersion: "0.110.0",
          moves: {
            "@agent-native/core/client/legacy": {
              to: "@agent-native/toolkit/not-exported",
            },
          },
        },
      ],
      apply: true,
    });

    expect(result.changes).toEqual([]);
    expect(fs.readFileSync(source, "utf-8")).toBe(before);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("not exported by an installed package"),
      ]),
    );
  });

  it("plans a moved import and dependency when the target package is missing", () => {
    const { root, source, packageFile } = fixture();
    fs.writeFileSync(
      source,
      'import { Editor } from "@agent-native/core/client/editor";\nvoid Editor;\n',
    );

    const result = runMigrationCodemods({
      root,
      manifests: [
        {
          sinceVersion: "0.110.0",
          moves: {
            "@agent-native/core/client/editor": {
              to: "@agent-native/toolkit/editor",
            },
          },
        },
      ],
      targetExists: createMigrationPlanningTargetResolver(root),
    });

    expect(result.warnings).toEqual([]);
    expect(result.changes.map((change) => change.file)).toEqual([
      source,
      packageFile,
    ]);
    expect(result.changes[0]?.after).toContain(
      'from "@agent-native/toolkit/editor"',
    );
    expect(result.changes[1]?.after).toContain(
      '"@agent-native/toolkit": "latest"',
    );
  });

  it("skips a missing subpath when the target package is installed", () => {
    const { root, source } = fixture();
    fs.writeFileSync(
      source,
      'import { Editor } from "@agent-native/core/client/editor";\nvoid Editor;\n',
    );
    const toolkitDir = path.join(root, "node_modules/@agent-native/toolkit");
    fs.mkdirSync(toolkitDir, { recursive: true });
    fs.writeFileSync(
      path.join(toolkitDir, "package.json"),
      `${JSON.stringify({
        name: "@agent-native/toolkit",
        exports: { ".": "./index.js" },
      })}\n`,
    );
    fs.writeFileSync(path.join(toolkitDir, "index.js"), "export {};\n");

    const result = runMigrationCodemods({
      root,
      manifests: [
        {
          sinceVersion: "0.110.0",
          moves: {
            "@agent-native/core/client/editor": {
              to: "@agent-native/toolkit/editor",
            },
          },
        },
      ],
      targetExists: createMigrationPlanningTargetResolver(root),
    });

    expect(result.changes).toEqual([]);
    expect(result.warnings).toEqual([
      expect.stringContaining("not exported by an installed package"),
    ]);
  });

  it("resolves migration targets from the owning workspace package", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "an-codemod-workspace-"),
    );
    roots.push(root);
    fs.writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify({ private: true, workspaces: ["apps/*"] })}\n`,
    );
    const appRoot = path.join(root, "apps/chat");
    const source = path.join(appRoot, "src/index.tsx");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(
      path.join(appRoot, "package.json"),
      `${JSON.stringify({
        name: "chat",
        dependencies: { "@agent-native/core": "0.110.2" },
      })}\n`,
    );
    fs.writeFileSync(
      source,
      'import { Editor } from "@agent-native/core/client/editor";\nvoid Editor;\n',
    );
    const toolkitDir = path.join(appRoot, "node_modules/@agent-native/toolkit");
    fs.mkdirSync(toolkitDir, { recursive: true });
    fs.writeFileSync(
      path.join(toolkitDir, "package.json"),
      `${JSON.stringify({
        name: "@agent-native/toolkit",
        exports: { "./editor": "./editor.js" },
      })}\n`,
    );
    fs.writeFileSync(path.join(toolkitDir, "editor.js"), "export {};\n");

    const result = runMigrationCodemods({
      root,
      manifests: [
        {
          sinceVersion: "0.110.0",
          moves: {
            "@agent-native/core/client/editor": {
              to: "@agent-native/toolkit/editor",
            },
          },
        },
      ],
      apply: true,
    });

    expect(result.warnings).toEqual([]);
    expect(fs.readFileSync(source, "utf-8")).toContain(
      'from "@agent-native/toolkit/editor"',
    );
  });
});
