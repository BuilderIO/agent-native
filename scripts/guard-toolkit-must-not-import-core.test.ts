import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findToolkitCoreImports,
  shouldScanToolkitFile,
} from "./guard-toolkit-must-not-import-core";

describe("toolkit must not import core guard", () => {
  it("rejects static imports and exports from any core entrypoint", () => {
    const violations = findToolkitCoreImports(
      "packages/toolkit/src/index.ts",
      `
        import { defineAction } from "@agent-native/core/action";
        export { AgentPanel } from '@agent-native/core/client';
        import "@agent-native/core/styles/agent-native.css";
      `,
    );

    assert.deepEqual(
      violations.map((item) => [item.line, item.specifier]),
      [
        [2, "@agent-native/core/action"],
        [3, "@agent-native/core/client"],
        [4, "@agent-native/core/styles/agent-native.css"],
      ],
    );
  });

  it("rejects dynamic imports and require calls", () => {
    const violations = findToolkitCoreImports(
      "packages/toolkit/scripts/build.cts",
      `
        const action = await import("@agent-native/core/action");
        const client = require('@agent-native/core/client');
      `,
    );

    assert.deepEqual(
      violations.map((item) => item.line),
      [2, 3],
    );
  });

  it("allows other packages and ignores comments and string content", () => {
    const violations = findToolkitCoreImports(
      "packages/toolkit/src/index.ts",
      `
        import { Button } from "@agent-native/ui";
        import { example } from "@agent-native/corex";
        // import "@agent-native/core/client";
        const example = "require('@agent-native/core/action')";
        const template = \`import("@agent-native/core/client")\`;
      `,
    );

    assert.deepEqual(violations, []);
  });

  it("scans Toolkit source, config, and scripts while excluding generated artifacts", () => {
    for (const file of [
      "packages/toolkit/src/index.ts",
      "packages/toolkit/src/design-system/default-adapter.tsx",
      "packages/toolkit/src/conformance/runner.tsx",
      "packages/toolkit/vite.config.ts",
      "packages/toolkit/scripts/finalize-build.mjs",
    ]) {
      assert.equal(shouldScanToolkitFile(file), true, file);
    }
    for (const file of [
      "packages/toolkit/dist/index.js",
      "packages/toolkit/node_modules/example/index.js",
      "packages/toolkit/src/generated/client.ts",
      "packages/toolkit/corpus/fixture.ts",
      "packages/core/src/index.ts",
    ]) {
      assert.equal(shouldScanToolkitFile(file), false, file);
    }
  });
});
