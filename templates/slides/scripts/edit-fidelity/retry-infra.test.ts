import { expect, it } from "vitest";

import { isRetryableInfraError } from "./retry-infra.ts";

it("retries timed-out read-only action and status requests", () => {
  expect(
    isRetryableInfraError(
      new Error("GET get-deck request timed out after 30000ms"),
    ),
  ).toBe(true);
  expect(
    isRetryableInfraError(
      new Error(
        "GET /_agent-native/actions/list-decks?limit=1 timed out after 30000ms",
      ),
    ),
  ).toBe(true);
});

it("does not retry timed-out mutating requests", () => {
  expect(
    isRetryableInfraError(
      new Error("create-deck request timed out after 30000ms"),
    ),
  ).toBe(false);
  expect(
    isRetryableInfraError(
      new Error("POST /_agent-native/auth/local-dev timed out after 30000ms"),
    ),
  ).toBe(false);
  expect(
    isRetryableInfraError(
      new Error("DELETE delete-deck request timed out after 30000ms"),
    ),
  ).toBe(false);
});
