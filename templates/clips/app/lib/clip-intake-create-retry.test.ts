import { describe, expect, it } from "vitest";

import { shouldRetryIntakeCreateResponse } from "./clip-intake-create-retry";

describe("shouldRetryIntakeCreateResponse", () => {
  it.each([
    ["streaming_upload_unavailable", 503],
    ["storage_setup_required", 503],
    ["intake_unavailable", 409],
    ["recording_owner_mismatch", 409],
    ["intake_context_unavailable", 503],
    ["hosted_storage_unavailable", 503],
    ["multipart_start_failed", 503],
  ] as const)(
    "does not retry structured intake error %s",
    async (errorCode, status) => {
      const response = Response.json(
        {
          errorCode,
          error: "Storage is unavailable.",
          details: {
            retryable:
              errorCode === "hosted_storage_unavailable" ||
              errorCode === "multipart_start_failed",
          },
        },
        { status },
      );

      await expect(shouldRetryIntakeCreateResponse(response)).resolves.toBe(
        false,
      );
      await expect(response.json()).resolves.toMatchObject({ errorCode });
    },
  );

  it("does not retry other responses explicitly marked permanent", async () => {
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

  it("does not auto-retry a transient typed failure after a row may exist", async () => {
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
    ).resolves.toBe(false);
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

  it("retries non-JSON 503 gateway responses by status", async () => {
    await expect(
      shouldRetryIntakeCreateResponse(
        new Response("unavailable", {
          status: 503,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    ).resolves.toBe(true);
  });
});
