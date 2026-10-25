import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findDeferredCounts,
  isServerSourcePath,
} from "./guard-no-deferred-server-counts.js";

const FILE = "templates/content/actions/record-editor-mount.ts";

function flagged(source: string) {
  return findDeferredCounts(FILE, source).map((finding) => finding.line);
}

describe("deferred server counts guard", () => {
  it("flags a count or track call inside a timer callback", () => {
    const source = [
      "setTimeout(() => {",
      "  try {",
      '    countOutcome("content_editor_mount_counts", { outcome });',
      "  } catch {}",
      "}, 0);",
      'setImmediate(() => track("page_saved", {}));',
      'queueMicrotask(function () { analytics.trackEvent("page_saved"); });',
      'globalThis.setTimeout(() => countActionFailure({ action: "x", status: 500 }));',
    ].join("\n");

    assert.deepEqual(flagged(source), [1, 6, 7, 8]);
  });

  it("allows counts inside the request and timers that do not count", () => {
    const source = [
      "try {",
      '  countOutcome("content_editor_mount_counts", {});',
      "} catch {",
      "  // coercion-ok: a count cannot change the response.",
      "}",
      "const timer = setTimeout(() => controller.abort(), 5_000);",
      "setTimeout(resolve, 0);",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("allows a timer that says why its count can wait", () => {
    const source = [
      "// guard:allow-deferred-count — the window flush carries a frozen backlog.",
      "setTimeout(() => {",
      '  countOutcome("content_editor_mount_counts", {});',
      "}, 0);",
      "setTimeout(() => {",
      "  // guard:allow-deferred-count — a test fixture.",
      '  track("page_saved");',
      "}, 0);",
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("scans server sources and skips browser code and tests", () => {
    assert.equal(isServerSourcePath(FILE), true);
    assert.equal(
      isServerSourcePath("templates/mail/server/lib/gmail-quota.ts"),
      true,
    );
    assert.equal(
      isServerSourcePath("packages/core/src/server/action-routes.ts"),
      true,
    );
    assert.equal(
      isServerSourcePath(
        "templates/content/app/components/editor/editor-merge-telemetry.ts",
      ),
      false,
    );
    assert.equal(
      isServerSourcePath(
        "templates/content/actions/record-editor-mount.test.ts",
      ),
      false,
    );
  });
});
