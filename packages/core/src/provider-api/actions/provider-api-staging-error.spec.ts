import { describe, expect, it, vi } from "vitest";

const stagingExecuteRequest = vi.fn();

vi.mock("../staging.js", () => ({
  stagingExecuteRequest,
}));

const { createProviderApiRequestAction } = await import("./provider-api.js");

describe("provider API staging errors", () => {
  it.each([
    "Staged dataset byte cap exceeded: this app already stores 50.0 MB (limit 50 MB). Delete older datasets before staging more data.",
    "Staged dataset cap exceeded: this app already has 100000 rows stored (limit 100000). Delete older datasets before staging more data.",
  ])(
    "adds recovery guidance for staged dataset caps while preserving the original error: %s",
    async (message) => {
      const originalError = new Error(message);
      stagingExecuteRequest.mockRejectedValue(originalError);
      const recoveryGuidance =
        "Recover by deleting older staged datasets with list-staged-datasets/delete-staged-dataset, or switch this request to saveToFile / a smaller staged result before trying again.";

      const action = createProviderApiRequestAction(
        { executeRequest: vi.fn() },
        {
          appId: "analytics",
          getOwnerEmail: () => "ada@example.com",
        },
      );

      await expect(
        action.run({
          provider: "gong",
          method: "POST",
          path: "/calls/extensive",
          stageAs: "gong_calls",
        }),
      ).rejects.toMatchObject({
        cause: originalError,
        message: `${message} ${recoveryGuidance}`,
      });
    },
  );
});
