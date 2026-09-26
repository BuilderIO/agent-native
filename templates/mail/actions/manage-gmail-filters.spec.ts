import { isActionContractError } from "@agent-native/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccessTokens: vi.fn(),
}));

vi.mock("./helpers.js", () => ({
  getAccessTokens: mocks.getAccessTokens,
}));

import action from "./manage-gmail-filters";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAccessTokens.mockResolvedValue([]);
});

describe("manage-gmail-filters action", () => {
  it("throws a typed, caller-facing ActionContractError when no Google account is connected", async () => {
    await expect(action.run({ operation: "list" })).rejects.toSatisfy(
      (err: unknown) => {
        expect(isActionContractError(err)).toBe(true);
        expect((err as Error).message).toBe(
          "No Google account connected. Connect Gmail first.",
        );
        expect((err as { statusCode?: number }).statusCode).toBeLessThan(500);
        return true;
      },
    );
  });
});
