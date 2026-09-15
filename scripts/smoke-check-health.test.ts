import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { referencedSameOriginAssetUrls } from "./smoke-check-health.ts";

describe("deployed HTML asset probe", () => {
  it("collects same-origin scripts, modulepreloads, and stylesheets only once", () => {
    const assets = referencedSameOriginAssetUrls(
      `
        <link rel="icon" href="/favicon.svg">
        <link rel="modulepreload" href="/assets/entry.js">
        <link rel="stylesheet" href="/assets/app.css">
        <link rel="modulepreload" href="/assets/entry.js">
        <link rel="stylesheet" data-href="/assets/lazy.css">
        <script type="module" src="/assets/entry.js"></script>
        <script data-src="/assets/lazy.js"></script>
        <script src="https://cdn.example.test/pixel.js"></script>
        <script>window.inline = true</script>
      `,
      "https://dispatch.example.test/overview",
    );

    assert.deepEqual(assets, [
      "https://dispatch.example.test/assets/entry.js",
      "https://dispatch.example.test/assets/app.css",
    ]);
  });

  it("resolves relative assets against the document base URL", () => {
    const assets = referencedSameOriginAssetUrls(
      `
        <base href="/app/">
        <script src="assets/main.js"></script>
      `,
      "https://dispatch.example.test/overview",
    );

    assert.deepEqual(assets, [
      "https://dispatch.example.test/app/assets/main.js",
    ]);
  });
});
