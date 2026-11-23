import assert from "node:assert/strict";
import { test } from "node:test";

import {
  failureDiagnostic,
  safeErrorDiagnostic,
  warehouseFailureCode,
} from "./failure-diagnostic.js";

await test("classifies warehouse response codes without exposing response data", () => {
  for (const [body, expected] of [
    [undefined, "body_unreadable"],
    ["", "body_empty"],
    ["private-fixture", "body_malformed"],
    ['{"message":"private-fixture"}', "code_absent"],
    ['{"errorCode":"private-fixture"}', "code_unrecognized"],
    ['{"errorCode":"ui_capability_required"}', "ui_capability_required"],
    [
      '{"data":{"errorCode":"workspace_credential_forbidden","message":"private-fixture"}}',
      "workspace_credential_forbidden",
    ],
    [
      '{"errorCode":"signed_in_browser_required"}',
      "signed_in_browser_required",
    ],
  ] as const) {
    const code = warehouseFailureCode(body);
    assert.equal(code, expected);
    assert.equal(code.includes("private-fixture"), false);
  }
});

await test("reports timeout without exposing Playwright request headers", () => {
  const error = new Error(
    "apiRequestContext.head: Timeout 10000ms exceeded.\nCall log:\n  - cookie: fake-session-value\n  - authorization: fake-bearer-value",
  );
  error.name = "TimeoutError";
  error.stack = undefined;
  assert.equal(
    safeErrorDiagnostic(error),
    "TimeoutError: apiRequestContext.head timeout 10000ms",
  );
  const httpError = new Error("HTTP 503 private payload");
  httpError.stack = undefined;
  assert.equal(safeErrorDiagnostic(httpError), "Error: HTTP 503");
  const unlocated = new Error("private payload");
  unlocated.stack = undefined;
  assert.equal(safeErrorDiagnostic(unlocated), "Error: details withheld");
  const fromHelper = new Error("private payload");
  fromHelper.stack =
    "Error: private payload\n    at check (/private/e2e/query-paging.ts:123:4)";
  assert.equal(
    safeErrorDiagnostic(fromHelper),
    "Error: details withheld at query-paging.ts:123",
  );
  const editorError = new Error(
    "cookie: fake-cookie\nauthorization: fake-token",
  );
  editorError.stack =
    "Error: cookie: fake-cookie\n    at check (/private/e2e/editor-preferences.ts:145:9)";
  assert.equal(
    safeErrorDiagnostic(editorError),
    "Error: details withheld at editor-preferences.ts:145",
  );
  assert.equal(safeErrorDiagnostic(editorError).includes("fake-"), false);
  const cancellationError = new Error("private payload");
  cancellationError.stack =
    "Error: private payload\n    at check (/private/e2e/query-cancellation.ts:445:9)\n    at run (/private/e2e/first-run-local.ts:706:3)";
  assert.equal(
    safeErrorDiagnostic(cancellationError),
    "Error: details withheld at query-cancellation.ts:445",
  );
  const coreError = new Error("cookie: fake-secret");
  coreError.stack =
    "Error: cookie: fake-secret\n    at check (/private/e2e/core-flows.ts:1401:7)";
  assert.equal(
    safeErrorDiagnostic(coreError),
    "Error: details withheld at core-flows.ts:1401",
  );
  assert.doesNotMatch(safeErrorDiagnostic(coreError), /fake-secret/);
  const defaultError = new Error("cookie: fake-secret");
  defaultError.stack =
    "Error: cookie: fake-secret\n    at check (/private/e2e/default-connection.ts:171:9)";
  const cleanupError = new Error("private payload");
  cleanupError.stack =
    "Error: private payload\n    at cleanup (/private/e2e/default-connection.ts:519:7)";
  const aggregate = safeErrorDiagnostic(
    new AggregateError([defaultError, cleanupError], "private aggregate"),
  );
  assert.match(aggregate, /default-connection\.ts:171/);
  assert.match(aggregate, /default-connection\.ts:519/);
  assert.doesNotMatch(aggregate, /fake-secret|private/);
  const unknown = new Error("private payload");
  unknown.stack =
    "Error: private payload\n    at check (/private/e2e/fake-secret.ts:42:1)";
  assert.equal(safeErrorDiagnostic(unknown), "Error: details withheld");
  const filesystemError = Object.assign(new Error("private path"), {
    code: "EEXIST",
  });
  filesystemError.stack = undefined;
  assert.equal(safeErrorDiagnostic(filesystemError), "Error: EEXIST");
});

await test("classifies known Playwright assertion timeouts without exposing matcher data", () => {
  const error = new Error(
    'expect(page).toHaveURL(expected) failed\n\nExpected pattern: /https:\/\/fake-user:fake-password@example.test/\nReceived string: "https://example.test/?token=fake-token"\nTimeout: 60000ms\n\nCall log:\n  - cookie: fake-cookie',
  );
  error.stack = undefined;
  assert.equal(
    safeErrorDiagnostic(error),
    "Error: expect(page).toHaveURL timeout 60000ms",
  );
  for (const message of [
    "expect(page).toHaveSecret(expected) failed\n\nTimeout: 60000ms\nReceived: fake-token",
    "expect(page).toHaveSecret(expected) failed\n\nReceived: HTTP 503 fake-token",
    "expect(page).toHaveURLsecret(expected) failed\n\nTimeout: 60000ms",
    "expect(page).toHaveURL(expected) failed\n\nTimeout: fake-secretms",
  ]) {
    const unknown = new Error(message);
    unknown.stack = undefined;
    assert.equal(safeErrorDiagnostic(unknown), "Error: details withheld");
  }
});

await test("records catalog failure time and typed code without provider payload", () => {
  const result = JSON.parse(
    failureDiagnostic(
      "refresh-data-browser-catalog",
      "POST",
      502,
      {
        data: {
          errorCode: "data_catalog_refresh_failed",
          credentials: "private-fixture",
        },
        message: "private-fixture",
        statusMessage: "private-fixture",
      },
      "2026-11-16T20:00:00.000Z",
    ),
  );
  assert.deepEqual(result, {
    observedAt: "2026-11-16T20:00:00.000Z",
    action: "refresh-data-browser-catalog",
    method: "POST",
    status: 502,
    errorCode: "data_catalog_refresh_failed",
  });
});

await test("distinguishes unreadable, absent and unrecognized codes without echoing them", () => {
  for (const [body, expected] of [
    [undefined, "body_unreadable"],
    [{ message: "private-fixture" }, "code_absent"],
    [{ errorCode: "private-fixture" }, "code_unrecognized"],
    [{ errorCode: "ui_capability_required" }, "ui_capability_required"],
  ] as const) {
    const result = failureDiagnostic(
      "get-data-browser-catalog",
      "GET",
      403,
      body,
    );
    assert.equal(JSON.parse(result).errorCode, expected);
    assert.equal(result.includes("private-fixture"), false);
  }
});

await test("identifies known settings routes without exposing unknown paths", () => {
  const timestamp = "2026-11-16T20:00:00.000Z";
  const known = JSON.parse(
    failureDiagnostic(
      undefined,
      "GET",
      502,
      {},
      timestamp,
      "/_agent-native/connection-status/builder",
    ),
  );
  assert.equal(known.route, "/_agent-native/connection-status/builder");
  const unknown = failureDiagnostic(
    undefined,
    "GET",
    502,
    {},
    timestamp,
    "/private-fixture",
  );
  assert.equal(unknown.includes("private-fixture"), false);
});

await test("identifies the native connection and flow stage without exposing arbitrary query data", () => {
  const id = `wconn1:${"a".repeat(64)}`;
  const result = JSON.parse(
    failureDiagnostic(
      "get-data-browser-catalog",
      "GET",
      403,
      {},
      undefined,
      undefined,
      { connectionId: id, stage: "browse catalog" },
    ),
  );
  assert.equal(result.connectionId, id);
  assert.equal(result.stage, "browse catalog");
  const unsafe = failureDiagnostic(
    "get-data-browser-catalog",
    "GET",
    403,
    {},
    undefined,
    undefined,
    { connectionId: "private-fixture", stage: "private-fixture" },
  );
  assert.equal(unsafe.includes("private-fixture"), false);
});

await test("report A2-DAILY-CLEANUP-CAUSE retains classified nested failures without leaking secrets", () => {
  const cleanup = new AggregateError(
    [Object.assign(new Error("cookie: fake-secret"), { code: "ECONNREFUSED" })],
    "private cleanup details",
  );
  const failure = new AggregateError(
    [new Error("HTTP 503 authorization: fake-token"), cleanup],
    "warmup and cleanup failed",
  );
  const result = safeErrorDiagnostic(failure);
  assert.equal((result.match(/AggregateError:/g) ?? []).length, 2);
  assert.match(result, /HTTP 503/);
  assert.match(result, /ECONNREFUSED/);
  assert.doesNotMatch(result, /fake-secret|fake-token|private cleanup/);

  const cyclic = new Error("private", { cause: failure });
  Object.defineProperty(cleanup, "cause", { value: cyclic });
  assert.match(safeErrorDiagnostic(cyclic), /cyclic/);
  const wide = new AggregateError(
    Array.from({ length: 100 }, () => new Error("private")),
  );
  assert.match(safeErrorDiagnostic(wide), /truncated/);
});
