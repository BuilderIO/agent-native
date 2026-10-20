import { describe, expect, it } from "vitest";

import { shouldRetryIntakeCreateResponse } from "./clip-intake-create-retry";

describe("shouldRetryIntakeCreateResponse", () => {
  it("does not retry a typed permanent provider failure", async () => {
    const response = Response.json(
      {
        errorCode: "streaming_upload_unavailable",
        details: { retryable: false },
      },
      { status: 503 },
    );

    await expect(shouldRetryIntakeCreateResponse(response)).resolves.toBe(
      false,
    );
    await expect(response.json()).resolves.toMatchObject({
      errorCode: "streaming_upload_unavailable",
    });
  });

  it("does not retry an explicitly permanent typed response", async () => {
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

  it("retries transient 503 responses", async () => {
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
        new Response("unavailable", { status: 503 }),
      ),
    ).resolves.toBe(true);
    await expect(
      shouldRetryIntakeCreateResponse(new Response("invalid", { status: 400 })),
    ).resolves.toBe(false);
  });
});
