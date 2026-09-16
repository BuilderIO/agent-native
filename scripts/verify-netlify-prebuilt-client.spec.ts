import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyNetlifyPrebuiltClientArtifact } from "./verify-netlify-prebuilt-client.ts";

function fixture(): { client: string; publish: string; root: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "netlify-client-pair-"));
  const client = path.join(root, "client");
  const publish = path.join(root, "publish");
  mkdirSync(path.join(client, "assets"), { recursive: true });
  mkdirSync(path.join(publish, "assets"), { recursive: true });
  return { client, publish, root };
}

test("accepts a client artifact copied into publish output", () => {
  const { client, publish, root } = fixture();
  try {
    writeFileSync(path.join(client, "manifest.json"), '{"icons":[]}');
    writeFileSync(path.join(publish, "manifest.json"), '{"icons":[]}');
    writeFileSync(path.join(client, "assets", "entry-abc.js"), "client");
    writeFileSync(path.join(publish, "assets", "entry-abc.js"), "client");

    assert.deepEqual(verifyNetlifyPrebuiltClientArtifact(client, publish), {
      checkedFiles: 2,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects missing or stale client files in publish output", () => {
  const { client, publish, root } = fixture();
  try {
    writeFileSync(path.join(client, "assets", "entry-abc.js"), "client");
    writeFileSync(path.join(publish, "assets", "entry-abc.js"), "base");
    writeFileSync(path.join(client, "assets", "route-def.js"), "route");

    assert.throws(
      () => verifyNetlifyPrebuiltClientArtifact(client, publish),
      /missing: assets\/route-def\.js; mismatched: assets\/entry-abc\.js/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
