import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  analyzeRequestStormSource,
  shouldScanRequestStormFile,
} from "./guard-request-storms";

describe("request storm guard", () => {
  it("rejects paid background and focus refetches without a rationale", () => {
    const violations = analyzeRequestStormSource({
      file: "templates/example/app/root.tsx",
      source: `
        const client = createClient({
          refetchIntervalInBackground: true,
          refetchOnWindowFocus: true,
        });
      `,
    });

    assert.deepEqual(
      violations.map((item) => item.rule),
      ["background-refetch", "focus-refetch"],
    );
  });

  it("rejects fixed polls at or below five seconds", () => {
    const violations = analyzeRequestStormSource({
      file: "templates/example/app/panel.tsx",
      source: `
        const fast = useQuery({ refetchInterval: 5_000 });
        const exponent = useQuery({ refetchInterval: 5e3 });
        const slow = useQuery({ refetchInterval: 5_001 });
        const conditional = useQuery({
          refetchInterval: (query) => query.state.data?.active ? 1_000 : false,
        });
      `,
    });

    assert.deepEqual(
      violations.map((item) => item.rule),
      ["fast-fixed-poll", "fast-fixed-poll"],
    );
  });

  it("accepts adjacent precise rationales", () => {
    const violations = analyzeRequestStormSource({
      file: "templates/example/app/root.tsx",
      source: `
        const client = createClient({
          // request-storm-allow: one user-triggered refresh for external provider state.
          refetchOnWindowFocus: true,
        });
      `,
    });

    assert.deepEqual(violations, []);
  });

  it("does not mistake documentation or strings for executable settings", () => {
    const violations = analyzeRequestStormSource({
      file: "packages/example/src/options.ts",
      source: `
        // refetchOnWindowFocus: true
        const docs = "refetchIntervalInBackground: true";
        const example = \`new EventSource("/example")\`;
      `,
    });

    assert.deepEqual(violations, []);
  });

  it("rejects app-owned EventSource but permits the core shared transport", () => {
    const source = `const events = new EventSource("/_agent-native/events");`;
    assert.equal(
      analyzeRequestStormSource({
        file: "templates/example/app/root.tsx",
        source,
      })[0]?.rule,
      "app-event-source",
    );
    assert.deepEqual(
      analyzeRequestStormSource({
        file: "packages/core/src/client/use-db-sync.ts",
        source,
      }),
      [],
    );
  });

  it("ignores tests, corpus, generated, and vendor files", () => {
    for (const file of [
      "templates/example/app/root.test.tsx",
      "packages/core/corpus/example.ts",
      "packages/example/src/generated/actions.ts",
      "templates/example/vendor/client.ts",
      "packages/example/src/action-types.generated.ts",
    ]) {
      assert.equal(shouldScanRequestStormFile(file), false, file);
    }
    assert.equal(
      shouldScanRequestStormFile("templates/example/app/root.tsx"),
      true,
    );
  });
});
