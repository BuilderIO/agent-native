import { describe, expect, it } from "vitest";

import { shouldRetryIntakeCreateResponse } from "./clip-intake-create-retry";

describe("shouldRetryIntakeCreateResponse", () => {
  it.each([
    ["streaming_upload_unavailable", 503, false],
    ["storage_setup_required", 503, false],
    ["intake_creation_in_progress", 409, true],
    ["intake_unavailable", 409, false],
    ["recording_owner_mismatch", 409, undefined],
    ["intake_context_unavailable", 503, undefined],
    ["hosted_storage_unavailable", 503, true],
    ["multipart_start_failed", 503, true],
  ] as const)(
    "uses structured retryability for intake error %s",
    async (errorCode, status, retryable) => {
      const response = Response.json(
        {
          errorCode,
          error: "Storage is unavailable.",
          ...(retryable !== undefined ? { details: { retryable } } : {}),
        },
        { status },
      );

      await expect(shouldRetryIntakeCreateResponse(response)).resolves.toBe(
        retryable === true,
      );
      await expect(response.json()).resolves.toMatchObject({ errorCode });
    },
  );

  it("does not retry other structured responses explicitly marked permanent", async () => {
    await expect(
      shouldRetryIntakeCreateResponse(
        Response.json(
          {
            errorCode: "provider_setup_required",
            details: { retryable: false },
          },
          { status: 503 },
        ),
      ),
    ).resolves.toBe(false);
  });

  it("retries a typed transient failure after the server marks cleanup safe", async () => {
    await expect(
      shouldRetryIntakeCreateResponse(
        Response.json(
          {
            errorCode: "hosted_storage_unavailable",
            details: { retryable: true },
          },
          { status: 503 },
        ),
      ),
    ).resolves.toBe(true);
  });

  it("keeps the status fallback for untyped retryable responses", async () => {
    await expect(
      shouldRetryIntakeCreateResponse(
        new Response("upstream unavailable", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      shouldRetryIntakeCreateResponse(new Response("invalid", { status: 400 })),
    ).resolves.toBe(false);
  });

  it("retries non-JSON and malformed 503 gateway responses by status", async () => {
    await expect(
      shouldRetryIntakeCreateResponse(
        new Response("unavailable", {
          status: 503,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      shouldRetryIntakeCreateResponse(
        new Response("{invalid", {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ).resolves.toBe(true);
  });
});
