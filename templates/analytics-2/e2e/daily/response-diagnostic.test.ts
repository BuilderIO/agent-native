import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyFailureResponse } from "./response-diagnostic";

await test("report A2-DAILY-503-DIAGNOSTICS preserves request shape without leaking values", () => {
  const result = classifyFailureResponse({
    url: "http://127.0.0.1:8105/home?_data=private-value&token=another-secret",
    method: "GET",
    resourceType: "fetch",
    headerNames: [
      "accept",
      "authorization",
      "cookie",
      "x-react-router-request",
    ],
    contentType: "application/json; charset=utf-8",
  });
  assert.deepEqual(result, {
    endpoint: "home",
    method: "GET",
    resourceType: "fetch",
    searchParams: ["_data", "other"],
    headers: ["accept", "x-react-router-request"],
    contentType: "application/json",
    body: "not-collected",
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(
    classifyFailureResponse({
      url: "http://127.0.0.1:8105/home",
      method: "GET",
      resourceType: "document",
      headerNames: [],
      contentType: "text/html",
    }).body,
    "not-collected",
  );
});
