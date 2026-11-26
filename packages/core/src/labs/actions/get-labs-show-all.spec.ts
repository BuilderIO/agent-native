import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUserLabsShowAll: vi.fn() }));

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string) => {
    throw new Error(message);
  },
}));
vi.mock("../store.js", () => mocks);

const action = (await import("./get-labs-show-all.js")).default;

beforeEach(() => vi.clearAllMocks());

describe("get-labs-show-all action", () => {
  it("reports the saved switch for the caller", async () => {
    mocks.getUserLabsShowAll.mockResolvedValue(true);
    await expect(
      action.run({}, { userEmail: "a@example.com" }),
    ).resolves.toEqual({ enabled: true });
    expect(mocks.getUserLabsShowAll).toHaveBeenCalledWith("a@example.com");
  });

  it("refuses an unauthenticated caller", async () => {
    await expect(action.run({}, {})).rejects.toThrow("Not authenticated.");
  });
});
