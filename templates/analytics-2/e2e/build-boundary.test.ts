import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  observeBuild,
  parseAppSourceSha,
  stableBuild,
} from "./build-boundary.js";

const a = "a".repeat(40);
const b = "b".repeat(40);

function fixture(status: number, source?: string) {
  let disposed = false;
  let requested: unknown;
  return {
    get disposed() {
      return disposed;
    },
    get requested() {
      return requested;
    },
    async get(url: string, options: unknown) {
      requested = { url, options };
      return {
        ok: () => status === 200,
        status: () => status,
        text: async () =>
          source === undefined
            ? "<html><head></head></html>"
            : `<html><head><meta name="agent-native-app-source-sha" content="${source}"></head></html>`,
        dispose: async () => {
          disposed = true;
        },
      };
    },
  };
}

await describe("report A2-FLOW-BUILD-BOUNDARY", async () => {
  await it("attributes only equal readable builds and preserves absent versus unreadable", async () => {
    const base = "https://fixture.invalid/app";
    const response = fixture(200, a);
    const before = await observeBuild(response, base);
    assert.deepEqual(before, { kind: "read", sha: a });
    assert.equal(response.disposed, true);
    assert.deepEqual(response.requested, {
      url: `${base}/home`,
      options: {
        timeout: 10000,
        maxRedirects: 0,
        headers: { "cache-control": "no-cache" },
      },
    });
    assert.equal(
      stableBuild(before, await observeBuild(fixture(200, a), base)),
      true,
    );
    assert.equal(
      stableBuild(before, await observeBuild(fixture(200, b), base)),
      false,
    );
    const absent = await observeBuild(fixture(200), base);
    assert.deepEqual(absent, { kind: "absent" });
    assert.equal(stableBuild(absent, absent), false);
    const unreadable = await observeBuild(fixture(503, a), base);
    assert.deepEqual(unreadable, { kind: "unreadable", reason: "HTTP503" });
    assert.equal(stableBuild(unreadable, unreadable), false);
    assert.deepEqual(await observeBuild(fixture(200, "malformed"), base), {
      kind: "unreadable",
      reason: "Invalid build identity",
    });
  });

  await it("reads the app source stamp instead of the workspace build header", () => {
    const header = '<meta name="agent-native-build-sha" content="' + b + '"/>';
    const source =
      '<meta name="agent-native-app-source-sha" content="' + a + '"/>';
    assert.deepEqual(parseAppSourceSha(header + source), {
      kind: "read",
      sha: a,
    });
    assert.deepEqual(parseAppSourceSha(header), { kind: "absent" });
    assert.deepEqual(
      parseAppSourceSha(
        source +
          '<meta name="agent-native-app-source-sha" content="' +
          b +
          '">',
      ),
      { kind: "unreadable", reason: "Ambiguous build identity" },
    );
  });
});
