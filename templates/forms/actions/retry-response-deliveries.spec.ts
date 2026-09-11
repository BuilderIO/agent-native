import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  response: { formId: "form_1" } as { formId: string } | null,
}));
const reconcileResponseDeliveries = vi.hoisted(() =>
  vi.fn(async (responseId: string) => ({
    id: responseId,
    retryable: false,
    success: true,
  })),
);
const assertAccess = vi.hoisted(() => vi.fn(async () => {}));

const dbMock = vi.hoisted(() => ({
  getDb: () => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => (state.response ? [state.response] : [])),
      })),
    })),
  }),
}));

vi.mock("../server/db/index.js", async () => ({
  getDb: dbMock.getDb,
  schema: await vi.importActual("../server/db/schema.js"),
}));

vi.mock("@agent-native/core/sharing", () => ({ assertAccess }));

vi.mock("../server/handlers/submissions.js", () => ({
  reconcileResponseDeliveries,
}));

const { default: retryResponseDeliveries } =
  await import("./retry-response-deliveries.js");

describe("retry-response-deliveries action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.response = { formId: "form_1" };
  });

  it("requires editor access and delegates reconciliation by response ID", async () => {
    const result = await retryResponseDeliveries.run({
      responseId: "response_1",
    });

    expect(assertAccess).toHaveBeenCalledWith("form", "form_1", "editor");
    expect(reconcileResponseDeliveries).toHaveBeenCalledWith("response_1");
    expect(result).toEqual({
      id: "response_1",
      retryable: false,
      success: true,
    });
  });

  it("does not reconcile a missing response", async () => {
    const originalResponse = state.response;
    state.response = null;

    await expect(
      retryResponseDeliveries.run({ responseId: "missing" }),
    ).rejects.toThrow("Response missing not found");

    expect(assertAccess).not.toHaveBeenCalled();
    expect(reconcileResponseDeliveries).not.toHaveBeenCalled();
    state.response = originalResponse;
  });
});
