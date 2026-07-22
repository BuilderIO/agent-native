import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeMajorityValue,
  extractTsconfigExtends,
  hasUnrenderedPlaceholder,
  packageScriptViolationMessage,
} from "./checks.ts";

describe("packageScriptViolationMessage", () => {
  it("flags a missing script", () => {
    const message = packageScriptViolationMessage("mail", "dev", undefined);
    assert.match(message ?? "", /missing a "dev" script/);
  });

  it("accepts a plain agent-native dev script", () => {
    assert.equal(
      packageScriptViolationMessage("mail", "dev", "agent-native dev"),
      null,
    );
  });

  it("accepts an env-var-prefixed agent-native dev script", () => {
    assert.equal(
      packageScriptViolationMessage(
        "analytics",
        "dev",
        "DATABASE_URL=${ANALYTICS_DATABASE_URL:-file:./data/app.db} agent-native dev",
      ),
      null,
    );
  });

  it("accepts a vitest test script with extra flags", () => {
    assert.equal(
      packageScriptViolationMessage(
        "tasks",
        "test",
        "vitest --run --config vitest.config.ts",
      ),
      null,
    );
  });

  it("rejects a test script that never calls vitest", () => {
    const message = packageScriptViolationMessage("tasks", "test", "jest --run");
    assert.match(message ?? "", /does not resolve through the expected/);
  });
});

describe("extractTsconfigExtends", () => {
  it("reads extends even with a JSONC line comment elsewhere in the file", () => {
    const raw = `{
  "extends": "@agent-native/core/tsconfig.base.json",
  "compilerOptions": {
    // TODO: flip after in-flight work lands
    "strict": false
  }
}`;
    assert.equal(
      extractTsconfigExtends(raw),
      "@agent-native/core/tsconfig.base.json",
    );
  });

  it("returns undefined when there is no extends field", () => {
    assert.equal(extractTsconfigExtends(`{ "compilerOptions": {} }`), undefined);
  });
});

describe("hasUnrenderedPlaceholder", () => {
  it("flags a real scaffold placeholder", () => {
    assert.equal(hasUnrenderedPlaceholder("# {{APP_NAME}} — Agent Guide"), true);
  });

  it("does not flag JSX inline-style double braces", () => {
    assert.equal(
      hasUnrenderedPlaceholder("<div style={{ display: 'flex' }} />"),
      false,
    );
  });
});

describe("computeMajorityValue", () => {
  it("returns the most common value", () => {
    assert.equal(
      computeMajorityValue(["^4.3.6", "^4.3.6", "^4.4.3"]),
      "^4.3.6",
    );
  });

  it("returns undefined for an empty list", () => {
    assert.equal(computeMajorityValue([]), undefined);
  });
});
