import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkMigrationManifest } from "./guard-migration-manifest";

const manifest = {
  name: "@agent-native/core",
  exports: { ".": "./dist/index.js", "./legacy": "./dist/legacy.js" },
  sideEffects: ["*.css"],
};

describe("migration manifest guard", () => {
  it("requires a manifest move for a published export removed from its snapshot", () => {
    const violations = checkMigrationManifest(
      { ...manifest, exports: { ".": "./dist/index.js" } },
      { exportKeys: [".", "./legacy"] },
      { moves: {} },
    );

    assert.match(
      violations[0]?.message ?? "",
      /@agent-native\/core\/legacy.*removed/,
    );
  });

  it("requires an exact manifest move for each tombstone export", () => {
    const violations = checkMigrationManifest(
      {
        ...manifest,
        exports: {
          ".": "./dist/index.js",
          "./legacy": "./dist/legacy.tombstone.js",
        },
        sideEffects: ["dist/legacy.tombstone.js"],
      },
      { exportKeys: [".", "./legacy"] },
      { moves: { "@agent-native/core": { to: "@agent-native/core/new" } } },
    );

    assert.match(
      violations[0]?.message ?? "",
      /@agent-native\/core\/legacy.*exact migration/,
    );
  });

  it("requires every tombstone target to be sideEffects-pinned", () => {
    const violations = checkMigrationManifest(
      {
        ...manifest,
        exports: {
          ".": "./dist/index.js",
          "./legacy": "./dist/legacy.tombstone.js",
        },
      },
      { exportKeys: [".", "./legacy"] },
      {
        moves: {
          "@agent-native/core/legacy": { to: "@agent-native/core/new" },
        },
      },
    );

    assert.match(
      violations[0]?.message ?? "",
      /legacy\.tombstone\.js.*sideEffects/,
    );
  });

  it("accepts an unchanged export snapshot and a pinned tombstone with its move", () => {
    assert.deepEqual(
      checkMigrationManifest(
        {
          ...manifest,
          exports: {
            ".": "./dist/index.js",
            "./legacy": "./dist/legacy.tombstone.js",
          },
          sideEffects: ["./dist/legacy.tombstone.js"],
        },
        { exportKeys: [".", "./legacy"] },
        {
          moves: {
            "@agent-native/core/legacy": { to: "@agent-native/core/new" },
          },
        },
      ),
      [],
    );
  });
});
