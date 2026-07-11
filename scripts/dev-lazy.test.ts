import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalLoopbackRedirect,
  isBrowserAssetDestination,
  selectProxyResponseTimeout,
} from "./dev-lazy";

describe("dev-lazy canonical loopback origin", () => {
  it("redirects localhost to the advertised 127.0.0.1 origin", () => {
    assert.equal(
      canonicalLoopbackRedirect(
        "localhost:8080",
        "/analytics?tab=dashboards",
        "http://127.0.0.1:8080",
      ),
      "http://127.0.0.1:8080/analytics?tab=dashboards",
    );
  });

  it("redirects 127.0.0.1 when localhost is the advertised origin", () => {
    assert.equal(
      canonicalLoopbackRedirect(
        "127.0.0.1:8080",
        "/analytics",
        "http://localhost:8080",
      ),
      "http://localhost:8080/analytics",
    );
  });

  it("does not redirect an already canonical request", () => {
    assert.equal(
      canonicalLoopbackRedirect(
        "127.0.0.1:8080",
        "/analytics",
        "http://127.0.0.1:8080",
      ),
      undefined,
    );
  });

  it("does not redirect a loopback host on a different port", () => {
    assert.equal(
      canonicalLoopbackRedirect(
        "localhost:8081",
        "/analytics",
        "http://127.0.0.1:8080",
      ),
      undefined,
    );
  });

  it("does not redirect external or forwarded development hosts", () => {
    assert.equal(
      canonicalLoopbackRedirect(
        "workspace.example.test",
        "/analytics",
        "http://127.0.0.1:8080",
      ),
      undefined,
    );
    assert.equal(
      canonicalLoopbackRedirect(
        "localhost:8080",
        "/analytics",
        "https://workspace.example.test",
      ),
      undefined,
    );
  });

  it("rejects malformed hosts and non-origin-form request targets", () => {
    assert.equal(
      canonicalLoopbackRedirect(
        "not a host",
        "/analytics",
        "http://127.0.0.1:8080",
      ),
      undefined,
    );
    assert.equal(
      canonicalLoopbackRedirect(
        "localhost:8080",
        "https://example.test/analytics",
        "http://127.0.0.1:8080",
      ),
      undefined,
    );
  });
});

describe("dev-lazy browser asset classification", () => {
  it("uses the interactive deadline for Vite module and style requests", () => {
    assert.equal(isBrowserAssetDestination("script"), true);
    assert.equal(isBrowserAssetDestination("style"), true);
    assert.equal(isBrowserAssetDestination("worker"), true);
    assert.equal(isBrowserAssetDestination("font"), true);
  });

  it("keeps API requests and document navigations out of the asset deadline", () => {
    assert.equal(isBrowserAssetDestination("empty"), false);
    assert.equal(isBrowserAssetDestination("document"), false);
    assert.equal(isBrowserAssetDestination(undefined), false);
  });

  it("accepts Node's array-shaped header values", () => {
    assert.equal(isBrowserAssetDestination(["SCRIPT"]), true);
  });

  it("keeps long deadlines only for non-browser API traffic", () => {
    const timeouts = { html: 5_000, browserAsset: 15_000, other: 120_000 };
    assert.equal(
      selectProxyResponseTimeout({ html: true, browserAsset: false }, timeouts),
      5_000,
    );
    assert.equal(
      selectProxyResponseTimeout({ html: false, browserAsset: true }, timeouts),
      15_000,
    );
    assert.equal(
      selectProxyResponseTimeout(
        { html: false, browserAsset: false },
        timeouts,
      ),
      120_000,
    );
  });
});
