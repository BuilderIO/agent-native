import { describe, expect, it } from "vitest";

import { isRunFailureRetryable } from "./run-failure-retry.js";

describe("isRunFailureRetryable", () => {
  it.each([
    "error:invalid_request",
    "error:invalid_request_error",
    "error:credits-limit-daily",
    "error:credits-limit-monthly",
    "error:http_402",
    "error:invalid_attachment",
    "error:model_not_found",
    "error:builder_model_unauthorized",
    "error:builder_auth_error",
    "error:missing_credentials",
    "error:http_401",
    "error:authentication_error",
    "missing_api_key",
    "error:provider_rate_limited",
    "error:http_429",
    "error:run_budget_exhausted",
    "error:billing_error",
    "error:request_too_large",
    "error:gateway_not_enabled",
    "error:aborted_user",
  ])("does not retry %s, which fails the same way again", (reason) => {
    expect(isRunFailureRetryable(reason)).toBe(false);
  });

  it.each([
    "error:stale_run",
    "error:builder_gateway_internal_error",
    "error:empty_completion",
    "error:background_worker_failed",
    "run_preparation_failed",
  ])("retries %s, which can clear on a second attempt", (reason) => {
    expect(isRunFailureRetryable(reason)).toBe(true);
  });
});
