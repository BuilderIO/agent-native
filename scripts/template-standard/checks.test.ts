import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  checkSsrRootRoute,
  checkSsrRouteHandler,
  computeMajorityValue,
  extractTsconfigExtends,
  hasUnrenderedPlaceholder,
  isRootSsrRouteReexport,
  packageScriptViolationMessage,
} from "./checks.ts";
import { isRetiredCompatibilityTemplate, listTemplates } from "./manifest.ts";

describe("retired template compatibility packages", () => {
  it("keeps retired host shims out of the live template standard", () => {
    assert.equal(isRetiredCompatibilityTemplate("videos"), true);
    assert.equal(listTemplates().includes("videos"), false);
  });
});

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
        "DATABASE_URL=${ANALYTICS_DATABASE_URL:-pglite:./data/pglite} agent-native dev",
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
    const message = packageScriptViolationMessage(
      "tasks",
      "test",
      "jest --run",
    );
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
    assert.equal(
      extractTsconfigExtends(`{ "compilerOptions": {} }`),
      undefined,
    );
  });
});

describe("hasUnrenderedPlaceholder", () => {
  it("flags a real scaffold placeholder", () => {
    assert.equal(
      hasUnrenderedPlaceholder("# {{APP_NAME}} — Agent Guide"),
      true,
    );
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

describe("isRootSsrRouteReexport", () => {
  it("accepts the catch-all re-export with either quote style", () => {
    assert.equal(
      isRootSsrRouteReexport('export { default } from "./[...page].get";\n'),
      true,
    );
    assert.equal(
      isRootSsrRouteReexport("export { default } from './[...page].get'"),
      true,
    );
  });

  it("rejects a separate root handler", () => {
    assert.equal(
      isRootSsrRouteReexport(
        'import { createH3SSRHandler } from "@agent-native/core/server/ssr-handler";\nexport default createH3SSRHandler(() => import("virtual:react-router/server-build"));',
      ),
      false,
    );
  });
});

describe("checkSsrRootRoute", () => {
  function scaffold(rootRoute?: string): string {
    const dir = mkdtempSync(join(tmpdir(), "ssr-root-route-"));
    mkdirSync(join(dir, "server", "routes"), { recursive: true });
    writeFileSync(
      join(dir, "server", "routes", "[...page].get.ts"),
      "export default handler;\n",
    );
    if (rootRoute !== undefined) {
      writeFileSync(join(dir, "server", "routes", "index.get.ts"), rootRoute);
    }
    return dir;
  }

  it("distinguishes a missing root route from one that is not a re-export", () => {
    const missing = scaffold();
    const wrong = scaffold("export default otherHandler;\n");
    const ok = scaffold('export { default } from "./[...page].get";\n');
    try {
      const messages = checkSsrRootRoute([missing, wrong, ok]).map(
        (violation) => violation.message,
      );
      assert.equal(messages.length, 2);
      assert.match(messages[0] ?? "", /is missing/);
      assert.match(messages[1] ?? "", /must only re-export the catch-all/);
    } finally {
      for (const dir of [missing, wrong, ok]) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("reports a scaffold source that has no catch-all at all", () => {
    const empty = mkdtempSync(join(tmpdir(), "ssr-root-route-"));
    try {
      assert.deepEqual(
        [...checkSsrRouteHandler([empty]), ...checkSsrRootRoute([empty])].map(
          (violation) => violation.rule,
        ),
        ["ssr-route-handler", "ssr-root-route"],
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
