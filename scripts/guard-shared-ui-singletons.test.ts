import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkSharedDependencyCatalogUsage,
  checkSharedUiSingletonResolutions,
  parsePnpmLockImporterResolutions,
} from "./guard-shared-ui-singletons";

function lockfile({
  coreYjs = "13.6.31",
  toolkitYjs = coreYjs,
  coreDialog = "1.1.18(react@19.2.7)",
  toolkitDialog = coreDialog,
}: {
  coreYjs?: string;
  toolkitYjs?: string;
  coreDialog?: string;
  toolkitDialog?: string;
} = {}): string {
  return `lockfileVersion: '9.0'

importers:

  packages/core:
    dependencies:
      '@radix-ui/react-dialog':
        specifier: ^1.1.0
        version: ${coreDialog}
      '@tiptap/core':
        specifier: ^3.0.0
        version: 3.28.0(@tiptap/pm@3.28.0)
      '@tiptap/pm':
        specifier: ^3.0.0
        version: 3.28.0
      y-protocols:
        specifier: ^1.0.0
        version: 1.0.7(yjs@${coreYjs})
      yjs:
        specifier: ^13.0.0
        version: ${coreYjs}

  packages/toolkit:
    dependencies:
      '@radix-ui/react-dialog':
        specifier: ^1.1.18
        version: ${toolkitDialog}
      '@tiptap/core':
        specifier: 3.28.0
        version: 3.28.0(@tiptap/pm@3.28.0)
      '@tiptap/pm':
        specifier: 3.28.0
        version: 3.28.0
      y-protocols:
        specifier: ^1.0.7
        version: 1.0.7(yjs@${toolkitYjs})
      yjs:
        specifier: ^13.6.31
        version: ${toolkitYjs}
`;
}

describe("shared UI singleton guard", () => {
  it("requires every shared direct dependency to use the workspace catalog", () => {
    assert.deepEqual(
      checkSharedDependencyCatalogUsage(
        { dependencies: { yjs: "catalog:", clsx: "catalog:" } },
        { dependencies: { yjs: "catalog:", clsx: "catalog:" } },
      ).errors,
      [],
    );

    assert.match(
      checkSharedDependencyCatalogUsage(
        { dependencies: { yjs: "^13.6.31" } },
        { dependencies: { yjs: "catalog:" } },
      ).errors[0] ?? "",
      /yjs.*must use catalog:/,
    );
  });

  it("uses pnpm's resolved locators instead of declared ranges", () => {
    const result = checkSharedUiSingletonResolutions(lockfile());

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.resolutions.yjs, {
      core: "13.6.31",
      toolkit: "13.6.31",
    });
  });

  it("rejects split yjs instances and their y-protocol peer locators", () => {
    const result = checkSharedUiSingletonResolutions(
      lockfile({ toolkitYjs: "13.6.32" }),
    );

    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0] ?? "", /y-protocols resolves differently/);
    assert.match(result.errors[1] ?? "", /yjs resolves differently/);
  });

  it("rejects shared Radix packages with different peer resolutions", () => {
    const result = checkSharedUiSingletonResolutions(
      lockfile({ toolkitDialog: "1.1.18(react@19.3.0)" }),
    );

    assert.equal(result.errors.length, 1);
    assert.match(
      result.errors[0] ?? "",
      /@radix-ui\/react-dialog resolves differently/,
    );
  });

  it("requires every editor singleton in both package importers", () => {
    const parsed = parsePnpmLockImporterResolutions(lockfile());
    parsed.get("packages/toolkit")?.delete("@tiptap/pm");
    const withoutTiptapPm = [...parsed]
      .map(([name, dependencies]) => {
        const lines = [...dependencies]
          .map(
            ([dependency, version]) =>
              `      '${dependency}':\n        version: ${version}`,
          )
          .join("\n");
        return `  ${name}:\n    dependencies:\n${lines}`;
      })
      .join("\n");
    const result = checkSharedUiSingletonResolutions(
      `importers:\n${withoutTiptapPm}\n`,
    );

    assert.match(
      result.errors[0] ?? "",
      /@tiptap\/pm must be a direct dependency/,
    );
  });
});
