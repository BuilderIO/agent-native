import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import type { Page, Request, Response } from "@playwright/test";

import {
  createFirstRunArtifacts,
  observeFirstRunNavigation,
} from "./first-run-diagnostics.js";

void test("report A2-FIRST-RUN-NAVIGATION-TIMEOUT: preserves unique server log and failure screenshot paths across runs", () => {
  const root = mkdtempSync(resolve(tmpdir(), "analytics-first-run-diag-"));
  try {
    const tmpDir = resolve(root, "tmp");
    const failureDir = resolve(root, "failure-shots");
    const first = createFirstRunArtifacts(tmpDir, failureDir);
    const second = createFirstRunArtifacts(tmpDir, failureDir);

    assert.notEqual(first.runId, second.runId);
    assert.notEqual(first.serverLogPath, second.serverLogPath);
    assert.notEqual(first.failureScreenshotPath, second.failureScreenshotPath);
    assert.equal(existsSync(first.serverLogPath), true);
    assert.equal(existsSync(second.serverLogPath), true);
    assert.equal(existsSync(failureDir), true);

    writeFileSync(first.serverLogPath, "first run server output");
    writeFileSync(second.serverLogPath, "second run server output");
    assert.equal(
      readFileSync(first.serverLogPath, "utf8"),
      "first run server output",
    );
    assert.equal(
      readFileSync(second.serverLogPath, "utf8"),
      "second run server output",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

void test("report A2-FIRST-RUN-NAVIGATION-TIMEOUT: records pending and failed same-origin navigation requests without leaking secrets", () => {
  const page = new EventEmitter() as unknown as Page;
  let now = 1000;
  const observer = observeFirstRunNavigation(
    page,
    "https://example.test",
    () => now,
  );
  const documentRequest = {
    url: () => "https://example.test/?token=secret-token",
    method: () => "GET",
    resourceType: () => "document",
  } as Request;
  const stuckScript = {
    url: () => "https://example.test/assets/entry.js?apiKey=private-key",
    method: () => "GET",
    resourceType: () => "script",
  } as Request;
  const failedStyle = {
    url: () => "https://example.test/assets/app.css?secret=hidden",
    method: () => "GET",
    resourceType: () => "stylesheet",
  } as Request;
  const foreignRequest = {
    url: () => "https://other.invalid/ignored.js",
    method: () => "GET",
    resourceType: () => "script",
  } as Request;

  page.emit("request", documentRequest);
  page.emit("request", stuckScript);
  page.emit("request", failedStyle);
  page.emit("request", foreignRequest);

  now = 1050;
  page.emit("response", {
    request: () => documentRequest,
    status: () => 200,
  } as Response);
  page.emit("requestfinished", documentRequest);
  page.emit("requestfailed", failedStyle);

  now = 31000;
  const snapshot = observer.snapshot();
  assert.equal(snapshot.pendingCount, 1);
  assert.equal(snapshot.omitted, 0);
  assert.deepEqual(snapshot.pending, [
    {
      method: "GET",
      pathname: "/assets/entry.js",
      resourceType: "script",
      status: null,
      state: "pending",
      startedMs: 0,
      elapsedMs: 30000,
    },
  ]);
  assert.deepEqual(snapshot.failed, [
    {
      method: "GET",
      pathname: "/assets/app.css",
      resourceType: "stylesheet",
      status: null,
      state: "failed",
      startedMs: 0,
      elapsedMs: 50,
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /secret-token|private-key|hidden|other\.invalid/,
  );

  observer.dispose();
  assert.equal((page as unknown as EventEmitter).eventNames().length, 0);
});
