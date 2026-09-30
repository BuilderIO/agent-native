import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  importSpecifiers,
  matchesPathFilter,
  mobileBundleInputs,
} from "./guard-mobile-build-paths.ts";

describe("mobile build path guard", () => {
  it("applies GitHub path filters in order, with later exclusions winning", () => {
    const patterns = [
      "packages/core/src/shared/**",
      "packages/core/src/action-ui.ts",
      "!packages/**/*.spec.ts",
    ];
    assert.equal(
      matchesPathFilter("packages/core/src/shared/auth/copy.ts", patterns),
      true,
    );
    assert.equal(
      matchesPathFilter("packages/core/src/action-ui.ts", patterns),
      true,
    );
    assert.equal(
      matchesPathFilter("packages/core/src/shared/copy.spec.ts", patterns),
      false,
    );
    assert.equal(
      matchesPathFilter("packages/core/src/server/routes.ts", patterns),
      false,
    );
    assert.equal(
      matchesPathFilter("packages/core/src/sharedx.ts", patterns),
      false,
    );
  });

  it("follows value imports and ignores type-only imports", () => {
    assert.deepEqual(
      importSpecifiers(
        [
          'import { a } from "./a.js";',
          'import type { B } from "./b.js";',
          'export * from "./c.js";',
          'export type { D } from "./d.js";',
          'import "./e.css";',
          'const f = await import("./f.js");',
        ].join("\n"),
      ),
      ["./a.js", "./c.js", "./e.css", "./f.js"],
    );
  });

  it("traces the mobile bundle into Core, AgentKit, and shared app config", () => {
    const inputs = mobileBundleInputs();
    assert.ok(inputs.includes("packages/agentkit/src/protocol/index.ts"));
    assert.ok(inputs.includes("packages/core/src/client/chat-errors.ts"));
    assert.ok(inputs.includes("packages/shared-app-config/index.ts"));
    assert.ok(
      !inputs.some((file) => file.startsWith("packages/core/src/server/")),
    );
  });
});
