import assert from "node:assert/strict";
import { test } from "node:test";

import {
  expectedAppIntentTransportFailure,
  expectedMissingProjectFailure,
} from "./runtime-errors.js";

await test("only the missing project's own 404 resource is expected", () => {
  const expected = expectedMissingProjectFailure(
    "https://example.test/app",
    "missing-123",
  );
  const url =
    "https://example.test/app/_agent-native/actions/get-project?projectId=missing-123";
  assert.equal(expected.response({ url, method: "GET", status: 404 }), true);
  assert.equal(
    expected.console({
      url,
      text: "Failed to load resource: the server responded with a status of 404 (Not Found)",
    }),
    true,
  );
  assert.equal(
    expected.console({
      url,
      text: "Failed to load resource: the server responded with a status of 404 ()",
    }),
    true,
  );
  assert.equal(expected.response({ url, method: "POST", status: 404 }), false);
  assert.equal(expected.response({ url, method: "GET", status: 500 }), false);
  assert.equal(
    expected.response({
      url: url.replace("missing-123", "other"),
      method: "GET",
      status: 404,
    }),
    false,
  );
  assert.equal(
    expected.response({
      url: url.replace("get-project", "list-projects"),
      method: "GET",
      status: 404,
    }),
    false,
  );
  assert.equal(
    expected.console({ url, text: "Unrelated application error" }),
    false,
  );
  assert.equal(
    expected.console({
      url: "https://example.test/other",
      text: "Failed to load resource: the server responded with a status of 404 (Not Found)",
    }),
    false,
  );
});

await test("only the intercepted start-analytics-thread 503 is expected in app-intent-transport", () => {
  const expected = expectedAppIntentTransportFailure(
    "https://example.test/analytics-2",
  );
  const url =
    "https://example.test/analytics-2/_agent-native/actions/start-analytics-thread";
  assert.equal(expected.response({ url, method: "POST", status: 503 }), true);
  assert.equal(
    expected.console({
      url,
      text: "Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
    }),
    true,
  );
  assert.equal(
    expected.console({
      url,
      text: "Failed to load resource: the server responded with a status of 503 ()",
    }),
    true,
  );
  assert.equal(expected.response({ url, method: "GET", status: 503 }), false);
  assert.equal(expected.response({ url, method: "POST", status: 500 }), false);
  assert.equal(
    expected.response({
      url: `${url}?extra=1`,
      method: "POST",
      status: 503,
    }),
    false,
  );
  assert.equal(
    expected.response({
      url: url.replace("start-analytics-thread", "list-projects"),
      method: "POST",
      status: 503,
    }),
    false,
  );
  assert.equal(
    expected.console({ url, text: "Unrelated application error" }),
    false,
  );
  assert.equal(
    expected.console({
      url: "https://example.test/other",
      text: "Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
    }),
    false,
  );
});
