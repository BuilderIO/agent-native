import { describe, expect, it, vi } from "vitest";

const getAccess = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/server/builder-dsi-access", () => ({
  getBuilderDsiAccess: getAccess,
}));

import action from "./get-builder-dsi-access.js";

describe("get-builder-dsi-access", () => {
  it.each([
    { status: "ready", eligible: true },
    { status: "missing", eligible: false },
    { status: "unavailable", eligible: null, reason: "store_unavailable" },
  ])(
    "preserves the shared $status status without accepting identity arguments",
    async (status) => {
      getAccess.mockReset().mockResolvedValue(status);
      expect(action.http).toEqual({ method: "GET" });
      expect(action.readOnly).toBe(true);
      await expect(
        action.run({
          userEmail: "another@example.test",
          eligible: true,
        } as never),
      ).resolves.toEqual(status);
      expect(getAccess).toHaveBeenCalledExactlyOnceWith();
    },
  );
});
