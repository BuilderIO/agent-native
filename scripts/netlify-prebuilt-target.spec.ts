import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveNetlifyPrebuiltTarget } from "./netlify-prebuilt-target.ts";

test("maps the beta chat site to the chat template and beta ref", () => {
  const target = resolveNetlifyPrebuiltTarget("beta", "chat");

  assert.equal(target.siteName, "chat");
  assert.equal(target.sourceTemplate, "chat");
  assert.equal(target.sourceRef, "beta");
  assert.equal(target.publishDirectory, "templates/chat/dist");
  assert.equal(
    target.functionsDirectory,
    "templates/chat/.netlify/functions-internal",
  );
  assert.match(target.host, /^beta\./);
  assert.match(target.siteId, /^[0-9a-f-]{36}$/);
});

test("maps the production chat alias to the starter site", () => {
  const target = resolveNetlifyPrebuiltTarget("production", "chat");

  assert.equal(target.siteName, "starter");
  assert.equal(target.sourceTemplate, "chat");
  assert.equal(target.sourceRef, "main");
  assert.equal(target.publishDirectory, "templates/chat/dist");
  assert.match(target.host, /^starter\./);
});

test("maps the framework production site to the docs project", () => {
  const target = resolveNetlifyPrebuiltTarget("production", "fw");

  assert.equal(target.siteName, "fw");
  assert.equal(target.sourceTemplate, "@agent-native/docs");
  assert.equal(target.publishDirectory, "packages/docs/dist");
  assert.equal(
    target.functionsDirectory,
    "packages/docs/.netlify/functions-internal",
  );
  assert.equal(target.host, "www.agent-native.com");
});

test("rejects production sites without a source project instead of guessing", () => {
  assert.throws(
    () => resolveNetlifyPrebuiltTarget("production", "workspace"),
    /no buildable template mapping/,
  );
});

test("resolves every repo-backed production inventory site", () => {
  const sites = JSON.parse(
    readFileSync("scripts/netlify-production-sites.json", "utf8"),
  ) as Record<string, unknown>;
  const unsupported = Object.keys(sites).filter((site) => {
    try {
      resolveNetlifyPrebuiltTarget("production", site);
      return false;
    } catch (error) {
      assert.match(String(error), /no buildable template mapping/);
      return true;
    }
  });

  assert.deepEqual(unsupported, ["workspace"]);
});

test("rejects unknown sites", () => {
  assert.throws(
    () => resolveNetlifyPrebuiltTarget("beta", "not-a-site"),
    /Unknown beta Netlify site/,
  );
});
