import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countingExportsOf,
  findDeferredCounts,
  isServerSourcePath,
  PACKAGE_EXPORTS,
} from "./guard-no-deferred-server-counts.js";

const FILE = "templates/content/actions/record-editor-mount.ts";

function flagged(source: string) {
  return findDeferredCounts(FILE, source).map((finding) => finding.line);
}

/** What `countingExportsOf` lists for each file, sorted. */
function listedFiles(sources: ReadonlyMap<string, string>) {
  return Object.fromEntries(
    [...countingExportsOf(sources)]
      .filter(([file]) => file !== PACKAGE_EXPORTS)
      .map(([file, names]) => [file, [...names].sort()]),
  );
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

  it("judges a method the file defines by its body, not its name", () => {
    const source = [
      "const registry = {",
      "  map(fn: () => void) {",
      "    handlers.push(fn);",
      "  },",
      "};",
      "const runner = {",
      "  map(fn: () => void) {",
      "    fn();",
      "  },",
      "};",
      'setTimeout(() => registry.map(() => track("page_saved")), 0);',
      'setTimeout(() => runner.map(() => track("page_saved")), 0);',
      "setTimeout(() => Array.from(trackIds), 0);",
    ].join("\n");

    assert.deepEqual(flagged(source), [12]);
  });

  it("follows a parameter a helper runs through a closure or an alias", () => {
    const source = [
      "function run(fn: () => void) {",
      "  const invoke = () => fn();",
      "  invoke();",
      "}",
      "function alias(fn: () => void) {",
      "  const go = fn;",
      "  go();",
      "}",
      "function keepLater(fn: () => void) {",
      "  const invoke = () => fn();",
      "  handlers.push(invoke);",
      "}",
      'setTimeout(() => run(() => track("page_saved")), 0);',
      'setTimeout(() => alias(() => track("page_saved")), 0);',
      'setTimeout(() => keepLater(() => track("page_saved")), 0);',
    ].join("\n");

    assert.deepEqual(flagged(source), [13, 14]);
  });

  it("judges a track-named function the file defines by its body", () => {
    const source = [
      "function trackRetry() {",
      "  return fetchAgain();",
      "}",
      'const trackSave = createTracker("save");',
      "setTimeout(trackRetry, 1_000);",
      "setTimeout(() => trackRetry(), 0);",
      "setTimeout(() => trackSave(), 0);",
    ].join("\n");

    assert.deepEqual(flagged(source), [7]);
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

  it("follows count helpers another server file exports", () => {
    const known = new Map([
      [
        "templates/content/actions/_content-save-outcomes.ts",
        new Set(["recordContentSaveOutcome"]),
      ],
    ]);
    const source = [
      'import { recordContentSaveOutcome, boundedContentSaveReason } from "./_content-save-outcomes.js";',
      'import * as outcomes from "./_content-save-outcomes.js";',
      'import { recordContentSaveOutcome as recordElsewhere } from "../../mail/actions/_content-save-outcomes.js";',
      "setTimeout(() => recordContentSaveOutcome({}), 0);",
      "setTimeout(() => outcomes.recordContentSaveOutcome({}), 0);",
      "setTimeout(() => boundedContentSaveReason(error), 0);",
      "setTimeout(() => recordElsewhere({}), 0);",
    ].join("\n");

    assert.deepEqual(
      findDeferredCounts(FILE, source, known).map((finding) => finding.line),
      [4, 5],
    );
  });

  it("takes a scanned file's answer for what it exports, default included", () => {
    const known = new Map([
      ["templates/content/actions/_outcomes.ts", new Set(["default"])],
      ["templates/content/actions/_retry.ts", new Set<string>()],
    ]);
    const source = [
      'import record from "./_outcomes.js";',
      'import { trackRetry } from "./_retry.js";',
      'import { trackEvent } from "./_unscanned.js";',
      "setTimeout(() => record({}), 0);",
      "setTimeout(() => trackRetry(), 0);",
      "setTimeout(() => trackEvent(), 0);",
    ].join("\n");

    assert.deepEqual(
      findDeferredCounts(FILE, source, known).map((finding) => finding.line),
      [4, 6],
    );
  });

  it("finds the exports that count, through wrappers and re-exports", () => {
    const sources = new Map([
      [
        "templates/content/actions/_outcomes.ts",
        [
          'import { countOutcome } from "@agent-native/core/tracking";',
          "export function recordOutcome(outcome: string) {",
          "  try {",
          '    countOutcome("content_save_outcome_counts", { outcome });',
          "  } catch {}",
          "}",
          "export function boundedReason(error: unknown) {",
          "  return String(error);",
          "}",
        ].join("\n"),
      ],
      [
        "templates/content/server/lib/outcome-wrappers.ts",
        [
          'import { recordOutcome } from "../../actions/_outcomes.js";',
          'export const recordSaved = () => recordOutcome("saved");',
          "export { recordOutcome as recordAgain };",
          'export { boundedReason } from "../../actions/_outcomes.js";',
        ].join("\n"),
      ],
      [
        "templates/content/server/lib/index.ts",
        'export * from "./outcome-wrappers.js";',
      ],
    ]);

    assert.deepEqual(listedFiles(sources), {
      "templates/content/actions/_outcomes.ts": ["recordOutcome"],
      "templates/content/server/lib/outcome-wrappers.ts": [
        "recordAgain",
        "recordSaved",
      ],
      "templates/content/server/lib/index.ts": ["recordAgain", "recordSaved"],
    });
  });

  it("finds default exports that count and leaves out ones that don't", () => {
    const sources = new Map([
      [
        "templates/content/actions/_record.ts",
        [
          'import { countOutcome } from "@agent-native/core/tracking";',
          "export default function record(outcome: string) {",
          '  countOutcome("content_save_outcome_counts", { outcome });',
          "}",
        ].join("\n"),
      ],
      [
        "templates/content/actions/_track-saved.ts",
        [
          'import { track } from "@agent-native/core/tracking";',
          'export default () => track("page_saved");',
        ].join("\n"),
      ],
      [
        "templates/content/actions/_track-opened.ts",
        [
          'import { track } from "@agent-native/core/tracking";',
          "export default function () {",
          '  track("page_opened");',
          "}",
        ].join("\n"),
      ],
      [
        "templates/content/server/lib/record-wrapper.ts",
        [
          'import save from "../../actions/_record.js";',
          'export const recordSaved = () => save("saved");',
          'export { default as recordAgain } from "../../actions/_record.js";',
        ].join("\n"),
      ],
      [
        "templates/content/server/lib/retry.ts",
        [
          "export function trackRetry(attempt: number) {",
          "  return attempt + 1;",
          "}",
        ].join("\n"),
      ],
    ]);

    assert.deepEqual(listedFiles(sources), {
      "templates/content/actions/_record.ts": ["default"],
      "templates/content/actions/_track-saved.ts": ["default"],
      "templates/content/actions/_track-opened.ts": ["default"],
      "templates/content/server/lib/record-wrapper.ts": [
        "recordAgain",
        "recordSaved",
      ],
      "templates/content/server/lib/retry.ts": [],
    });
  });

  it("lists the members of exported objects and namespace re-exports", () => {
    const sources = new Map([
      [
        "templates/content/actions/_counters.ts",
        [
          'import { countOutcome } from "@agent-native/core/tracking";',
          "function trackRetry() {",
          "  return 1;",
          "}",
          'const trackSave = () => countOutcome("content_save_outcome_counts", {});',
          "export const counters = {",
          "  record(outcome: string) {",
          '    countOutcome("content_save_outcome_counts", { outcome });',
          "  },",
          "  retry() {",
          "    return 1;",
          "  },",
          "};",
          "export const analytics = { trackRetry, trackSave } as const;",
          "export class Tally {",
          '  static record = () => countOutcome("content_save_outcome_counts", {});',
          "}",
          "export const loose = { ...counters };",
        ].join("\n"),
      ],
      [
        "templates/content/actions/_barrel.ts",
        [
          'export * as outcomes from "./_counters.js";',
          'export * from "@agent-native/core/tracking";',
        ].join("\n"),
      ],
    ]);

    assert.deepEqual(listedFiles(sources), {
      "templates/content/actions/_counters.ts": [
        "Tally.",
        "Tally.prototype.",
        "Tally.record",
        "analytics.",
        "analytics.trackSave",
        "counters.",
        "counters.record",
        "loose.",
        "loose.record",
      ],
      "templates/content/actions/_barrel.ts": [
        "*",
        "outcomes.",
        "outcomes.Tally.",
        "outcomes.Tally.prototype.",
        "outcomes.Tally.record",
        "outcomes.analytics.",
        "outcomes.analytics.trackSave",
        "outcomes.counters.",
        "outcomes.counters.record",
        "outcomes.loose.",
        "outcomes.loose.record",
      ],
    });
  });

  it("follows members and re-exports into the files that list them", () => {
    const known = new Map([
      [
        "templates/content/actions/_counters.ts",
        new Set([
          "Tally.",
          "Tally.record",
          "analytics.",
          "analytics.trackSave",
          "counters.",
          "counters.record",
        ]),
      ],
      [
        "templates/content/actions/_barrel.ts",
        new Set([
          "*",
          "outcomes.",
          "outcomes.counters.",
          "outcomes.counters.record",
        ]),
      ],
      [
        "templates/content/actions/_tally.ts",
        new Set(["default.", "default.record"]),
      ],
    ]);
    const source = [
      'import { counters, analytics, Tally, loose } from "./_counters.js";',
      'import { outcomes, countOutcome, trackRetry } from "./_barrel.js";',
      'import tally from "./_tally.js";',
      'setTimeout(() => counters.record("saved"), 0);',
      "setTimeout(() => analytics.trackRetry(), 0);",
      "setTimeout(() => Tally.record(), 0);",
      'setTimeout(() => outcomes.counters.record("saved"), 0);',
      "setTimeout(() => outcomes.counters.retry(), 0);",
      'setTimeout(() => countOutcome("content_save_outcome_counts", {}), 0);',
      "setTimeout(() => trackRetry(), 0);",
      "setTimeout(() => tally.record(), 0);",
      "setTimeout(() => loose.trackSave(), 0);",
    ].join("\n");

    assert.deepEqual(
      findDeferredCounts(FILE, source, known).map((finding) => finding.line),
      [4, 6, 7, 9, 10, 11, 12],
    );
  });

  it("follows spreads, destructuring, instances and inherited methods", () => {
    const sources = new Map([
      [
        "templates/content/actions/_counters.ts",
        [
          'import { countOutcome } from "@agent-native/core/tracking";',
          "export const counters = {",
          "  record() {",
          '    countOutcome("content_save_outcome_counts", {});',
          "  },",
          "};",
          "export const copy = { ...counters, retry() {} };",
          "export const { record } = counters;",
          "export class Base {",
          "  static record() {",
          '    countOutcome("content_save_outcome_counts", {});',
          "  }",
          "}",
          "export class Child extends Base {}",
          "export class Reporter {",
          "  record() {",
          '    countOutcome("content_save_outcome_counts", {});',
          "  }",
          "  retry() {}",
          "}",
          "export const reporter = new Reporter();",
        ].join("\n"),
      ],
    ]);
    const known = countingExportsOf(sources);
    const source = [
      'import { copy, counters, Child, Reporter, reporter, record } from "./_counters.js";',
      "const { record: save } = counters;",
      "const local = new Reporter();",
      "class Job {",
      "  reporter = new Reporter();",
      "  start() {",
      "    setTimeout(() => this.reporter.record(), 0);",
      "  }",
      "}",
      "setTimeout(() => copy.record(), 0);",
      "setTimeout(() => copy.retry(), 0);",
      "setTimeout(save, 0);",
      "setTimeout(record, 0);",
      "setTimeout(() => Child.record(), 0);",
      "setTimeout(() => new Reporter().record(), 0);",
      "setTimeout(() => local.record(), 0);",
      "setTimeout(() => local.retry(), 0);",
      "setTimeout(() => reporter.record(), 0);",
    ].join("\n");

    assert.deepEqual(
      findDeferredCounts(FILE, source, known).map((finding) => finding.line),
      [7, 10, 12, 13, 14, 15, 16, 18],
    );
  });

  it("looks up count helpers the repo's packages export by name", () => {
    const sources = new Map([
      [
        "packages/core/src/jobs/automation-events.ts",
        [
          'import { countCredentialState } from "../tracking/failure-counters.js";',
          "export function countAutomationCredentialState(code: string): void {",
          "  countCredentialState({ code });",
          "}",
          "export function countLines(text: string): number {",
          '  return text.split("\\n").length;',
          "}",
        ].join("\n"),
      ],
    ]);
    const known = countingExportsOf(sources);
    const source = [
      'import { countAutomationCredentialState, countLines, trackEvent } from "@agent-native/core/server";',
      'setTimeout(() => countAutomationCredentialState("expired"), 0);',
      'setTimeout(() => countLines("a"), 0);',
      'setTimeout(() => trackEvent("saved"), 0);',
    ].join("\n");

    assert.deepEqual(
      findDeferredCounts(FILE, source, known).map((finding) => finding.line),
      [2, 4],
    );
  });

  it("keeps what a subclass overrides and what another file spreads", () => {
    const sources = new Map([
      [
        "templates/content/actions/_counters.ts",
        [
          'import { countOutcome } from "@agent-native/core/tracking";',
          "export class Base {",
          "  static record() {",
          '    countOutcome("content_save_outcome_counts", {});',
          "  }",
          "  record() {",
          '    countOutcome("content_save_outcome_counts", {});',
          "  }",
          "  save() {",
          '    countOutcome("content_save_outcome_counts", {});',
          "  }",
          "}",
          "export class Quiet extends Base {",
          "  static record() {}",
          "  record() {}",
          "}",
          "export const counters = {",
          "  record() {",
          '    countOutcome("content_save_outcome_counts", {});',
          "  },",
          "  trackRetry() {",
          "    retryLater();",
          "  },",
          "};",
        ].join("\n"),
      ],
      [
        "templates/content/actions/_spread.ts",
        [
          'import { counters } from "./_counters.js";',
          "export const copy = { ...counters };",
        ].join("\n"),
      ],
    ]);
    const known = countingExportsOf(sources);
    const source = [
      'import { Base, Quiet } from "./_counters.js";',
      'import { copy } from "./_spread.js";',
      "setTimeout(() => Quiet.record(), 0);",
      "setTimeout(() => new Quiet().record(), 0);",
      "setTimeout(() => new Quiet().save(), 0);",
      "setTimeout(() => Base.record(), 0);",
      "setTimeout(() => copy.record(), 0);",
      "setTimeout(() => copy.trackRetry(), 0);",
    ].join("\n");

    assert.deepEqual(
      findDeferredCounts(FILE, source, known).map((finding) => finding.line),
      [5, 6, 7],
    );
  });

  it("leaves names re-exported whole from an unscanned module to their names", () => {
    const sources = new Map([
      [
        "templates/content/actions/_barrel.ts",
        'export * from "../shared/helpers.js";',
      ],
    ]);
    assert.deepEqual(listedFiles(sources), {
      "templates/content/actions/_barrel.ts": ["*"],
    });
    const source = [
      'import { retry, trackSave } from "./_barrel.js";',
      "setTimeout(() => trackSave(), 0);",
      "setTimeout(() => retry(), 0);",
    ].join("\n");

    assert.deepEqual(
      findDeferredCounts(FILE, source, countingExportsOf(sources)).map(
        (finding) => finding.line,
      ),
      [2],
    );
  });

  it("follows local helpers that hand a callback on to a timer", () => {
    const source = [
      "const later = (fn: () => void) => setTimeout(fn, 0);",
      "function soon(run: () => void) {",
      "  queueMicrotask(() => run());",
      "}",
      "function schedule(fn: () => void) {",
      "  later(fn);",
      "}",
      "function store(fn: () => void) {",
      "  pending.push(fn);",
      "}",
      "function now(fn: () => void) {",
      "  fn();",
      "}",
      'later(() => countOutcome("content_save_outcome_counts", {}));',
      'soon(() => track("page_saved"));',
      'schedule(() => countOutcome("content_save_outcome_counts", {}));',
      'store(() => countOutcome("content_save_outcome_counts", {}));',
      'now(() => countOutcome("content_save_outcome_counts", {}));',
      "later(() => sweepExpired());",
      "// guard:allow-deferred-count — a test fixture.",
      'later(() => track("page_saved"));',
    ].join("\n");

    assert.deepEqual(flagged(source), [14, 15, 16]);
  });

  it("follows helpers another server file exports that hand a callback on to a timer", () => {
    const sources = new Map([
      [
        "templates/content/actions/_timers.ts",
        [
          "export const later = (fn: () => void) => setTimeout(fn, 0);",
          "export function soon(run: () => void) {",
          "  queueMicrotask(() => run());",
          "}",
          "export const scheduler = {",
          "  defer(fn: () => void) {",
          "    later(fn);",
          "  },",
          "  now(fn: () => void) {",
          "    fn();",
          "  },",
          "};",
          "export function store(fn: () => void) {",
          "  pending.push(fn);",
          "}",
        ].join("\n"),
      ],
      [
        "templates/content/actions/_jobs.ts",
        [
          'import { later } from "./_timers.js";',
          "export function schedule(task: () => void) {",
          "  later(() => task());",
          "}",
          'export { soon as eventually } from "./_timers.js";',
        ].join("\n"),
      ],
      [
        "templates/content/actions/_outcomes.ts",
        [
          "export function recordSave() {",
          '  countOutcome("content_save_outcome_counts", {});',
          "}",
        ].join("\n"),
      ],
      [
        "templates/content/actions/_wrapped.ts",
        [
          'import { recordSave } from "./_outcomes.js";',
          "export function save() {",
          "  recordSave();",
          "}",
          "export const wait = (fn: () => void) => setTimeout(fn, 0);",
        ].join("\n"),
      ],
    ]);
    assert.deepEqual(listedFiles(sources), {
      "templates/content/actions/_jobs.ts": ["eventually.(0)", "schedule.(0)"],
      "templates/content/actions/_outcomes.ts": ["recordSave"],
      "templates/content/actions/_wrapped.ts": ["save", "wait.(0)"],
      // A file that names no count is read only for what it defers.
      "templates/content/actions/_timers.ts": [
        "later.(0)",
        "scheduler.defer.(0)",
        "soon.(0)",
      ],
    });
    const source = [
      'import { later, scheduler, store } from "./_timers.js";',
      'import * as timers from "./_timers.js";',
      'import { eventually, schedule } from "./_jobs.js";',
      'later(() => countOutcome("content_save_outcome_counts", {}));',
      'timers.soon(() => track("page_saved"));',
      'scheduler.defer(() => track("page_saved"));',
      'scheduler.now(() => track("page_saved"));',
      'store(() => track("page_saved"));',
      'schedule(() => countOutcome("content_save_outcome_counts", {}));',
      'eventually(() => track("page_saved"));',
      "later(() => sweepExpired());",
    ].join("\n");

    assert.deepEqual(
      findDeferredCounts(FILE, source, countingExportsOf(sources)).map(
        (finding) => finding.line,
      ),
      [4, 5, 6, 9, 10],
    );
  });

  it("doesn't take a function the file names setTimeout for a timer", () => {
    const source = [
      'import { countOutcome } from "@agent-native/core/tracking";',
      "function setTimeout(run: () => void) {",
      "  run();",
      "}",
      'setTimeout(() => countOutcome("content_save_outcome_counts", {}));',
      'globalThis.setTimeout(() => countOutcome("content_save_outcome_counts", {}), 0);',
    ].join("\n");

    assert.deepEqual(flagged(source), [6]);
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
