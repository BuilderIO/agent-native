import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import type { Page, Request, Response } from "@playwright/test";

import { observeNotebookReload } from "./notebook-reload-diagnostic.js";

test("records bounded lifecycle without private request data and removes listeners", () => {
  const page = new EventEmitter() as unknown as Page;
  let now = 100;
  const observer = observeNotebookReload(page, () => now);
  const project = {
    url: () =>
      "https://example.test/_agent-native/actions/get-project?secret=private",
    method: () => "GET",
  } as Request;
  const batch = {
    url: () => "https://example.test/_agent-native/actions/get-actions-batch",
    method: () => "POST",
    postData: () => "secret body",
  } as Request;
  const other = {
    url: () => "https://example.test/private-route",
    method: () => "GET",
  } as Request;
  page.emit("request", project);
  page.emit("request", batch);
  page.emit("request", other);
  now = 125;
  page.emit("response", {
    request: () => project,
    status: () => 200,
  } as Response);
  assert.deepEqual(observer.snapshot(), {
    omitted: 0,
    requests: [
      {
        kind: "get-project",
        startedMs: 0,
        status: 200,
        state: "pending",
        elapsedMs: 25,
      },
      {
        kind: "batch-membership-unknown",
        startedMs: 0,
        status: null,
        state: "pending",
        elapsedMs: 25,
      },
    ],
  });
  now = 140;
  page.emit("requestfailed", project);
  page.emit("requestfinished", batch);
  for (let i = 0; i < 21; i++)
    page.emit("request", { url: project.url, method: project.method });
  const snapshot = observer.snapshot();
  assert.equal(snapshot.omitted, 3);
  assert.equal(snapshot.requests[0].state, "failed");
  assert.equal(snapshot.requests[1].state, "finished");
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /secret|private|example|https|body/,
  );
  observer.dispose();
  assert.equal((page as unknown as EventEmitter).eventNames().length, 0);
});
