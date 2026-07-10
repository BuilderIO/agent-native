import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptDesktopDesignPreviewGeneration,
  deriveDesktopDesignPreviewPartition,
  getDesktopDesignPreviewMotionCss,
  getDesktopDesignPreviewNavigationDecision,
  parseDesktopDesignPreviewHostBounds,
  parseDesktopDesignPreviewRequest,
  parseDesktopDesignPreviewUrl,
  shouldTearDownDesktopDesignPreviewForOwnerNavigation,
} from "./design-preview-protocol";

const UPDATE = {
  action: "update",
  appId: "design",
  workspaceId: "workspace-1",
  connectionId: "connection-1",
  screenId: "screen-1",
  generation: 42,
  url: "https://app.example.test/account",
  previewBounds: { x: 10, y: 20, width: 800, height: 600 },
  clipBounds: { x: 0, y: 0, width: 1000, height: 700 },
  mode: "interact",
  presentation: "focused",
  scale: 1,
  rotationDegrees: 0,
  borderRadius: 0,
  devicePixelRatio: 2,
  obscured: false,
  visible: true,
} as const;

describe("native Design preview protocol", () => {
  it("shares a deterministic persistent partition within one connection", () => {
    const scope = {
      appId: "design",
      workspaceId: "workspace-1",
      connectionId: "connection-1",
    };
    const partition = deriveDesktopDesignPreviewPartition(scope);
    assert.match(partition ?? "", /^persist:design-preview:[a-f0-9]{64}$/);
    assert.equal(deriveDesktopDesignPreviewPartition(scope), partition);
  });

  it("isolates sessions across workspaces and explicit connections", () => {
    const base = deriveDesktopDesignPreviewPartition({
      appId: "design",
      workspaceId: "workspace-1",
      connectionId: "connection-1",
    });
    assert.notEqual(
      deriveDesktopDesignPreviewPartition({
        appId: "design",
        workspaceId: "workspace-2",
        connectionId: "connection-1",
      }),
      base,
    );
    assert.notEqual(
      deriveDesktopDesignPreviewPartition({
        appId: "design",
        workspaceId: "workspace-1",
        connectionId: "connection-2",
      }),
      base,
    );
  });

  it("rejects spoofed apps and malformed partition identifiers", () => {
    for (const scope of [
      { appId: "mail", workspaceId: "workspace-1", connectionId: "c" },
      { appId: "design", workspaceId: "", connectionId: "c" },
      { appId: "design", workspaceId: "w\nspoof", connectionId: "c" },
      { appId: "design", workspaceId: "w", connectionId: "x".repeat(257) },
    ]) {
      assert.equal(deriveDesktopDesignPreviewPartition(scope), null);
    }
  });

  it("accepts HTTPS and loopback HTTP but rejects unsafe URL forms", () => {
    for (const url of [
      "https://app.example.test/login",
      "http://localhost:5173/login",
      "http://127.0.0.1:5173/login",
      "http://[::1]:5173/login",
    ]) {
      assert.equal(parseDesktopDesignPreviewUrl(url)?.toString(), url);
    }

    for (const url of [
      "http://app.example.test/login",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,hello",
      "ftp://app.example.test/file",
      "https://user:password@app.example.test/",
      "https://app.example.test/" + "x".repeat(8_192),
      "not a url",
    ]) {
      assert.equal(parseDesktopDesignPreviewUrl(url), null);
    }
  });

  it("allows same-origin navigation and blocks links from replacing Design with another origin", () => {
    assert.deepEqual(
      getDesktopDesignPreviewNavigationDecision(
        "https://app.example.test/account",
        "https://app.example.test/settings?tab=profile#name",
      ),
      {
        action: "allow",
        url: "https://app.example.test/settings?tab=profile#name",
      },
    );

    for (const requested of [
      "https://auth.example.test/login",
      "https://evil.example/",
      "http://app.example.test/downgrade",
      "javascript:alert(1)",
    ]) {
      assert.equal(
        getDesktopDesignPreviewNavigationDecision(
          "https://app.example.test/account",
          requested,
        ).action,
        "block",
      );
    }
  });

  it("accepts only strictly newer non-negative safe generations", () => {
    assert.equal(acceptDesktopDesignPreviewGeneration(undefined, 0), true);
    assert.equal(acceptDesktopDesignPreviewGeneration(0, 1), true);
    assert.equal(acceptDesktopDesignPreviewGeneration(2, 2), false);
    assert.equal(acceptDesktopDesignPreviewGeneration(2, 1), false);
    assert.equal(acceptDesktopDesignPreviewGeneration(undefined, -1), false);
    assert.equal(
      acceptDesktopDesignPreviewGeneration(
        undefined,
        Number.MAX_SAFE_INTEGER + 1,
      ),
      false,
    );
  });

  it("tears down an owner preview only for cross-document main-frame navigation", () => {
    assert.equal(
      shouldTearDownDesktopDesignPreviewForOwnerNavigation(false, true),
      true,
    );
    assert.equal(
      shouldTearDownDesktopDesignPreviewForOwnerNavigation(true, true),
      false,
    );
    assert.equal(
      shouldTearDownDesktopDesignPreviewForOwnerNavigation(false, false),
      false,
    );
    assert.equal(
      shouldTearDownDesktopDesignPreviewForOwnerNavigation(true, false),
      false,
    );
  });

  it("suppresses CSS motion without changing persisted source", () => {
    const css = getDesktopDesignPreviewMotionCss();
    assert.match(css, /animation:\s*none\s*!important/);
    assert.match(css, /transition:\s*none\s*!important/);
    assert.match(css, /scroll-behavior:\s*auto\s*!important/);
    assert.match(css, /\*::before/);
    assert.match(css, /\*::after/);
  });

  it("parses a bounded update and destroy request", () => {
    assert.deepEqual(parseDesktopDesignPreviewRequest(UPDATE), UPDATE);
    assert.deepEqual(
      parseDesktopDesignPreviewRequest({
        action: "destroy",
        appId: "design",
        workspaceId: "workspace-1",
        connectionId: "connection-1",
        screenId: "screen-1",
        generation: 43,
      }),
      {
        action: "destroy",
        appId: "design",
        workspaceId: "workspace-1",
        connectionId: "connection-1",
        screenId: "screen-1",
        generation: 43,
      },
    );
    assert.deepEqual(
      parseDesktopDesignPreviewRequest({
        action: "snapshot-ready",
        appId: "design",
        workspaceId: "workspace-1",
        connectionId: "connection-1",
        screenId: "screen-1",
        generation: 44,
        version: 2,
      }),
      {
        action: "snapshot-ready",
        appId: "design",
        workspaceId: "workspace-1",
        connectionId: "connection-1",
        screenId: "screen-1",
        generation: 44,
        version: 2,
      },
    );
  });

  it("rejects malformed, oversized, and unsupported update fields", () => {
    const invalidRequests = [
      null,
      { ...UPDATE, appId: "mail" },
      { ...UPDATE, workspaceId: "" },
      { ...UPDATE, screenId: "x".repeat(257) },
      { ...UPDATE, generation: -1 },
      { ...UPDATE, generation: 1.5 },
      { ...UPDATE, generation: "2" },
      { ...UPDATE, url: "http://example.test" },
      { ...UPDATE, mode: "inspect" },
      { ...UPDATE, presentation: "canvas" },
      { ...UPDATE, scale: 0 },
      { ...UPDATE, scale: 4.01 },
      { ...UPDATE, scale: "1" },
      { ...UPDATE, rotationDegrees: Number.NaN },
      { ...UPDATE, rotationDegrees: "0" },
      { ...UPDATE, borderRadius: -1 },
      { ...UPDATE, borderRadius: "0" },
      { ...UPDATE, devicePixelRatio: 0 },
      { ...UPDATE, devicePixelRatio: "2" },
      { ...UPDATE, obscured: "false" },
      { ...UPDATE, visible: 1 },
      {
        action: "snapshot-ready",
        appId: "design",
        workspaceId: "workspace-1",
        connectionId: "connection-1",
        screenId: "screen-1",
        generation: 44,
        version: 0,
      },
      {
        ...UPDATE,
        previewBounds: { x: 0, y: 0, width: 16_385, height: 100 },
      },
      {
        ...UPDATE,
        clipBounds: { x: 32_769, y: 0, width: 100, height: 100 },
      },
      {
        ...UPDATE,
        previewBounds: { x: "0", y: 0, width: 100, height: 100 },
      },
    ];
    for (const request of invalidRequests) {
      assert.equal(parseDesktopDesignPreviewRequest(request), null);
    }
  });

  it("bounds shell-reported owner geometry", () => {
    assert.deepEqual(
      parseDesktopDesignPreviewHostBounds({
        x: -1920,
        y: 0,
        width: 1920,
        height: 1080,
      }),
      { x: -1920, y: 0, width: 1920, height: 1080 },
    );
    assert.equal(
      parseDesktopDesignPreviewHostBounds({
        x: 0,
        y: 0,
        width: Number.POSITIVE_INFINITY,
        height: 100,
      }),
      null,
    );
  });
});
