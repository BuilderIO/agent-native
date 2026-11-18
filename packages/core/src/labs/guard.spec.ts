import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUserLabEnabled: vi.fn() }));

vi.mock("../action.js", () => ({
  fail: (message: string, options?: { statusCode?: number }) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("./store.js", () => mocks);

const { assertLabEnabled } = await import("./guard.js");

beforeEach(() => mocks.getUserLabEnabled.mockReset());

describe("assertLabEnabled", () => {
  it("passes when the lab is on for the user", async () => {
    mocks.getUserLabEnabled.mockResolvedValue(true);
    await expect(
      assertLabEnabled({ key: "clips.editor" }, { userEmail: "a@example.com" }),
    ).resolves.toBeUndefined();
    expect(mocks.getUserLabEnabled).toHaveBeenCalledWith(
      "a@example.com",
      "clips.editor",
      { orgId: undefined },
    );
  });

  it("refuses with 403 when the lab is off", async () => {
    mocks.getUserLabEnabled.mockResolvedValue(false);
    await expect(
      assertLabEnabled("clips.editor", { userEmail: "a@example.com" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("refuses an unauthenticated caller with 401", async () => {
    await expect(assertLabEnabled("clips.editor", {})).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});
