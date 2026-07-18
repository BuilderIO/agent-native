import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkMigrationManifest } from "./guard-migration-manifest";

const manifest = {
  name: "@agent-native/core",
  exports: { ".": "./dist/index.js", "./legacy": "./dist/legacy.js" },
  sideEffects: ["*.css"],
};
const snapshot = {
  exports: { ".": ["dist/index.js"], "./legacy": ["dist/legacy.js"] },
};

describe("migration manifest guard", () => {
  it("never permits a published export to disappear, even with a manifest move", () => {
    const violations = checkMigrationManifest(
      { ...manifest, exports: { ".": "./dist/index.js" } },
      snapshot,
      {
        moves: {
          "@agent-native/core/legacy": { to: "@agent-native/core/new" },
        },
      },
    );

    assert.match(
      violations[0]?.message ?? "",
      /@agent-native\/core\/legacy.*keep the export.*tombstone/,
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
      snapshot,
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
      snapshot,
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
        snapshot,
        {
          moves: {
            "@agent-native/core/legacy": { to: "@agent-native/core/new" },
          },
        },
      ),
      [],
    );
  });

  it("accepts conditional declaration and runtime tombstone targets", () => {
    assert.deepEqual(
      checkMigrationManifest(
        {
          ...manifest,
          exports: {
            ".": "./dist/index.js",
            "./legacy": {
              types: "./dist/legacy.tombstone.d.ts",
              import: "./dist/legacy.tombstone.js",
              default: "./dist/legacy.tombstone.js",
            },
          },
          sideEffects: ["./dist/legacy.tombstone.js"],
        },
        snapshot,
        {
          moves: {
            "@agent-native/core/legacy": { to: "@agent-native/core/new" },
          },
        },
      ),
      [],
    );
  });

  it("rejects changed targets unless the new target is a tombstone", () => {
    const violations = checkMigrationManifest(
      {
        ...manifest,
        exports: {
          ".": "./dist/index.js",
          "./legacy": "./dist/another-runtime.js",
        },
      },
      snapshot,
      {
        moves: {
          "@agent-native/core/legacy": { to: "@agent-native/core/new" },
        },
      },
    );

    assert.match(
      violations[0]?.message ?? "",
      /changed its published export target.*tombstone/,
    );
  });
});
