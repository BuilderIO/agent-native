import { describe, expect, it } from "vitest";

import { shouldRetryIntakeCreateResponse } from "./clip-intake-create-retry";

describe("shouldRetryIntakeCreateResponse", () => {
  it.each([
    ["streaming_upload_unavailable", 503],
    ["storage_setup_required", 503],
    ["intake_unavailable", 409],
    ["recording_owner_mismatch", 409],
    ["intake_context_unavailable", 503],
  ])("does not retry permanent intake error %s", async (errorCode, status) => {
    const response = Response.json(
      {
        errorCode,
        ...(errorCode === "streaming_upload_unavailable"
          ? { details: { retryable: false } }
          : {}),
      },
      { status },
    );

    await expect(shouldRetryIntakeCreateResponse(response)).resolves.toBe(
      false,
    );
    await expect(response.json()).resolves.toMatchObject({ errorCode });
  });

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
        Response.json({ error: "unavailable" }, { status: 503 }),
      ),
    ).resolves.toBe(true);
    await expect(
      shouldRetryIntakeCreateResponse(new Response("invalid", { status: 400 })),
    ).resolves.toBe(false);
  });

  it("does not retry when a 503 response body is unreadable", async () => {
    await expect(
      shouldRetryIntakeCreateResponse(
        new Response("unavailable", { status: 503 }),
      ),
    ).resolves.toBe(false);
  });
});
