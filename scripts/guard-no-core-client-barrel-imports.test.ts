import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findCoreClientBarrelImports,
  shouldScanCoreClientBarrelFile,
} from "./guard-no-core-client-barrel-imports";

describe("core client barrel import guard", () => {
  it("rejects static imports and exports from the deprecated client barrel", () => {
    const violations = findCoreClientBarrelImports(
      "templates/example/app/root.tsx",
      `
        import { AgentPanel } from "@agent-native/core/client";
        export { AgentChatHome } from '@agent-native/core/client';
        import "@agent-native/core/client";
      `,
    );

    assert.deepEqual(
      violations.map((item) => item.line),
      [2, 3, 4],
    );
  });

  it("allows focused client subpaths and ignores comments and dynamic imports", () => {
    const violations = findCoreClientBarrelImports(
      "templates/example/app/root.tsx",
      `
        import { AgentPanel } from "@agent-native/core/client/agent-chat";
        export { CommandMenu } from "@agent-native/core/client/navigation";
        // import { AgentPanel } from "@agent-native/core/client";
        const lazy = import("@agent-native/core/client");
      `,
    );

    assert.deepEqual(violations, []);
  });

  it("rejects test mocks that still target the deprecated barrel", () => {
    const violations = findCoreClientBarrelImports(
      "templates/example/app/root.test.tsx",
      `
        vi.mock("@agent-native/core/client", () => ({}));
        vi.doMock( '@agent-native/core/client', () => ({}) );
        vi.mock("@agent-native/core/client/hooks", () => ({}));
      `,
    );

    assert.deepEqual(
      violations.map((item) => item.line),
      [2, 3],
    );
  });

  it("excludes compatibility, generated files, and corpus snapshots", () => {
    for (const file of [
      "packages/core/src/client/index.ts",
      "packages/core/src/generated/example.ts",
      "packages/core/corpus/templates/example/app/root.tsx",
    ]) {
      assert.equal(shouldScanCoreClientBarrelFile(file), false, file);
    }
    assert.equal(
      shouldScanCoreClientBarrelFile("templates/example/app/root.tsx"),
      true,
    );
    assert.equal(
      shouldScanCoreClientBarrelFile("templates/example/app/root.test.tsx"),
      true,
    );
  });
});
