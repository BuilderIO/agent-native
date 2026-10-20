import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  verifyNetlifyPrebuiltClientArtifact,
  verifyNetlifyPrebuiltServerManifest,
} from "./verify-netlify-prebuilt-client.ts";

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

test("allows Netlify to rewrite its generated redirects file", () => {
  const { client, publish, root } = fixture();
  try {
    writeFileSync(path.join(client, "_redirects"), "source redirect\n");
    writeFileSync(
      path.join(publish, "_redirects"),
      "source redirect\n/* /.netlify/functions/server 200\n",
    );
    writeFileSync(path.join(client, "_headers"), "source headers\n");
    writeFileSync(
      path.join(publish, "_headers"),
      "source headers\n/*\n  cache-control: public\n",
    );

    assert.deepEqual(verifyNetlifyPrebuiltClientArtifact(client, publish), {
      checkedFiles: 2,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifies the trusted server manifest against publish output", () => {
  const { client, publish, root } = fixture();
  const server = path.join(root, "server");
  try {
    mkdirSync(server, { recursive: true });
    writeFileSync(path.join(client, "assets", "entry-abc.js"), "client");
    writeFileSync(path.join(publish, "assets", "entry-abc.js"), "client");
    writeFileSync(path.join(publish, "assets", "route-def.js"), "route");
    writeFileSync(
      path.join(server, "main.mjs"),
      'const route = "/assets/entry-abc.js,/assets/route-def.js"; const api = "/api/v1/assets/by-url"; const glob = "/assets/**"; import "./assets/server-chunk.mjs";',
    );

    assert.deepEqual(verifyNetlifyPrebuiltServerManifest(server, publish), {
      checkedAssets: 2,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects trusted server manifest assets missing from publish output", () => {
  const { root, publish } = fixture();
  const server = path.join(root, "server");
  try {
    mkdirSync(server, { recursive: true });
    writeFileSync(
      path.join(server, "main.mjs"),
      'const route = "/assets/missing-abc.js";',
    );

    assert.throws(
      () => verifyNetlifyPrebuiltServerManifest(server, publish),
      /missing: \/assets\/missing-abc\.js/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects trusted server manifest paths outside publish output", () => {
  const { root, publish } = fixture();
  const server = path.join(root, "server");
  try {
    mkdirSync(server, { recursive: true });
    writeFileSync(
      path.join(server, "main.mjs"),
      'const route = "/assets/../../secret.js";',
    );

    assert.throws(
      () => verifyNetlifyPrebuiltServerManifest(server, publish),
      /outside publish output/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
