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

  it("flags intervals and tracking wrappers", () => {
    const source = [
      'setInterval(() => countOutcome("content_editor_mount_counts", {}), 60_000);',
      'setTimeout(() => trackLifecycleEvent("page_opened"), 0);',
      'setTimeout(() => trackActionEvent("edit-document", {}), 0);',
    ].join("\n");

    assert.deepEqual(flagged(source), [1, 2, 3]);
  });

  it("follows callbacks and helpers the file defines", () => {
    const source = [
      "function flushCounts() {",
      '  countOutcome("content_editor_mount_counts", {});',
      "}",
      "const report = () => flushCounts();",
      "setTimeout(flushCounts, 0);",
      "setTimeout(() => report(), 0);",
      "setTimeout(report);",
      "setTimeout(track, 0);",
    ].join("\n");

    assert.deepEqual(flagged(source), [5, 6, 7, 8]);
  });

  it("follows names the file binds to a timer", () => {
    const source = [
      "const defer = setTimeout;",
      "const later = globalThis.setImmediate.bind(globalThis);",
      'defer(() => countOutcome("content_editor_mount_counts", {}), 0);',
      'later(() => track("page_saved"));',
      'queue.defer(() => countOutcome("content_editor_mount_counts", {}));',
    ].join("\n");

    assert.deepEqual(flagged(source), [3, 4]);
  });

  it("follows timer aliases through any number of hops", () => {
    const source = [
      "const defer = setTimeout;",
      "const later = defer;",
      "const timers = { soon: later };",
      'later(() => countOutcome("content_editor_mount_counts", {}), 0);',
      'timers.soon(() => track("page_saved"));',
      "const pause = sleep;",
      'pause(() => track("page_saved"));',
    ].join("\n");

    assert.deepEqual(flagged(source), [4, 5]);
  });

  it("resolves each name in its own scope", () => {
    const source = [
      "function sweep() {",
      "  const flush = () => sweepExpired();",
      "  setTimeout(flush, 0);",
      "}",
      "function flush() {",
      '  countOutcome("content_editor_mount_counts", {});',
      "}",
      "setTimeout(flush, 0);",
      "function drain(flush: () => void) {",
      "  setTimeout(flush, 0);",
      "}",
    ].join("\n");

    assert.deepEqual(flagged(source), [8]);
  });

  it("follows callbacks passed as methods", () => {
    const source = [
      "class Counter {",
      "  flush() {",
      '    countOutcome("content_editor_mount_counts", {});',
      "  }",
      "  start() {",
      "    setTimeout(() => this.flush(), 0);",
      "    setTimeout(this.flush.bind(this), 0);",
      "  }",
      "}",
      "class Sweeper {",
      "  flush() {",
      "    sweepExpired();",
      "  }",
      "  start() {",
      "    setInterval(this.flush, 60_000);",
      "  }",
      "}",
      "function report() {",
      '  track("page_saved");',
      "}",
      'const queue = { flush() { countOutcome("content_editor_mount_counts", {}); }, report };',
      "setTimeout(queue.flush);",
      "setTimeout(() => queue.report(), 0);",
      "setImmediate(cache.flush);",
    ].join("\n");

    assert.deepEqual(flagged(source), [6, 7, 22, 23]);
  });

  it("follows timers imported under another name", () => {
    const source = [
      'import { setTimeout as defer, setImmediate } from "node:timers";',
      'import * as timers from "node:timers";',
      'import { wait } from "./wait";',
      'defer(() => countOutcome("content_editor_mount_counts", {}), 0);',
      'setImmediate(() => track("page_saved"));',
      'timers.setInterval(() => track("page_saved"), 1_000);',
      'wait(() => track("page_saved"));',
    ].join("\n");

    assert.deepEqual(flagged(source), [4, 5, 6]);
  });

  it("follows helpers and timers bound by destructuring", () => {
    const source = [
      "const queue = {",
      '  flush() { countOutcome("content_editor_mount_counts", {}); },',
      "  sweep() { sweepExpired(); },",
      "};",
      "const { flush, sweep } = queue;",
      "const { setTimeout: later } = globalThis;",
      "const { trackEvent: send } = analytics;",
      "setTimeout(flush, 0);",
      "setTimeout(sweep, 0);",
      "later(() => sweepExpired(), 0);",
      'setTimeout(() => send("page_saved"), 0);',
      "later(flush);",
    ].join("\n");

    assert.deepEqual(flagged(source), [8, 11, 12]);
  });

  it("counts a function a callback defines only where it runs", () => {
    const source = [
      "setTimeout(() => {",
      '  const later = () => track("page_saved");',
      "  cache.later = later;",
      "}, 0);",
      "setTimeout(() => {",
      '  items.forEach((item) => countOutcome("content_editor_mount_counts", { item }));',
      "}, 0);",
      "setTimeout(() => {",
      '  const later = () => track("page_saved");',
      "  later();",
      "}, 0);",
      'setTimeout(() => ({ flush() { track("page_saved"); } }), 0);',
      'setTimeout(() => new Promise(() => track("page_saved")), 0);',
    ].join("\n");

    assert.deepEqual(flagged(source), [5, 8, 13]);
  });

  it("follows functions passed by name to calls", () => {
    const source = [
      "const trackId = currentPage();",
      "function flush() {",
      '  countOutcome("content_editor_mount_counts", {});',
      "}",
      "setTimeout(() => {",
      '  const record = () => track("page_saved");',
      "  [1].forEach(record);",
      "}, 0);",
      "setTimeout(() => Promise.resolve().then(flush), 0);",
      "setTimeout(() => flush.call(null), 0);",
      "setTimeout(() => flush.apply(null, []), 0);",
      "setTimeout(() => notify(trackId), 0);",
      "setTimeout(() => items.map(track), 0);",
    ].join("\n");

    assert.deepEqual(flagged(source), [5, 9, 10, 11, 13]);
  });

  it("does not take a call that may only keep a function to run it", () => {
    const source = [
      "setTimeout(() => {",
      '  const later = () => track("page_saved");',
      "  register(later);",
      '  cache.set("k", later);',
      '  emitter.on("saved", () => track("page_saved"));',
      "}, 0);",
      "function keep(fn: () => void) {",
      "  handlers.push(() => fn());",
      "}",
      'setTimeout(() => keep(() => track("page_saved")), 0);',
    ].join("\n");

    assert.deepEqual(flagged(source), []);
  });

  it("follows functions handed to calls that run them", () => {
    const source = [
      'const record = () => track("page_saved");',
      "function run(fn: () => void) {",
      "  fn();",
      "}",
      "function each(fn: () => void) {",
      "  [1].forEach(fn);",
      "}",
      "const runLater = run;",
      'setTimeout(() => run(() => track("page_saved")), 0);',
      "setTimeout(() => each(record), 0);",
      "setTimeout(() => runLater(record), 0);",
      "setTimeout(() => Array.from(ids, record), 0);",
      "setTimeout(() => Promise.try(record), 0);",
    ].join("\n");

    assert.deepEqual(flagged(source), [9, 10, 11, 12, 13]);
  });

  it("follows a count helper imported under another name", () => {
    const source = [
      'import { countOutcome as record } from "@agent-native/core/server";',
      'import { sweep } from "./sweep";',
      'setTimeout(() => record("content_editor_mount_counts", {}), 0);',
      "setTimeout(() => sweep(), 0);",
    ].join("\n");

    assert.deepEqual(flagged(source), [3]);
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
      "function retry() {",
      "  return fetchAgain();",
      "}",
      "setTimeout(retry, 1_000);",
      "setInterval(() => sweepExpired(), 60_000);",
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
        "community-templates/account-expert/actions/get-workflow.ts",
      ),
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
