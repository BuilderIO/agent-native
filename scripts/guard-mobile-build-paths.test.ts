import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  importSpecifiers,
  matchesPathFilter,
  mobileBundleInputs,
  packageBuildInputs,
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

  it("counts the compiler configs and build scripts behind each bundled dist", () => {
    const core = packageBuildInputs("packages/core");
    for (const file of [
      "packages/core/package.json",
      "packages/core/tsconfig.json",
      "packages/core/tsconfig.cli.json",
      "packages/core/scripts/finalize-build.mjs",
    ]) {
      assert.ok(core.includes(file), file);
    }
    assert.ok(
      packageBuildInputs("packages/agentkit").includes(
        "packages/agentkit/tsconfig.json",
      ),
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
