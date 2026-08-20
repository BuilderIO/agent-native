import { describe, expect, it, vi } from "vitest";

const stagingExecuteRequest = vi.fn();

vi.mock("../staging.js", () => ({
  stagingExecuteRequest,
}));

const { createProviderApiRequestAction } = await import("./provider-api.js");

describe("provider API staging errors", () => {
  it("adds recovery guidance when staged dataset byte cap is exhausted", async () => {
    stagingExecuteRequest.mockRejectedValue(
      new Error(
        "Staged dataset byte cap exceeded: this app already stores 50.0 MB (limit 50 MB). Delete older datasets before staging more data.",
      ),
    );

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
    ).rejects.toThrow(
      /Recover by deleting older staged datasets with list-staged-datasets\/delete-staged-dataset, or switch this request to saveToFile \/ a smaller staged result before trying again\./,
    );
  });
});
