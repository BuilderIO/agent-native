import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setUserLabsShowAll: vi.fn(),
  syncLabsAppState: vi.fn(),
}));

vi.mock("../../action.js", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string) => {
    throw new Error(message);
  },
}));
vi.mock("../store.js", () => mocks);
vi.mock("../app-state.js", () => mocks);

const action = (await import("./set-labs-show-all.js")).default;

beforeEach(() => vi.clearAllMocks());

describe("set-labs-show-all action", () => {
  it("saves the switch and mirrors it to application state", async () => {
    const states = {
      "clips.editor": { enabled: true, source: "all", mixed: false },
    };
    mocks.setUserLabsShowAll.mockResolvedValue(states);

    await expect(
      action.run(
        { enabled: true },
        { userEmail: "a@example.com", orgId: "org-1" },
      ),
    ).resolves.toEqual({ enabled: true, states });
    expect(mocks.setUserLabsShowAll).toHaveBeenCalledWith(
      "a@example.com",
      true,
      { orgId: "org-1" },
    );
    expect(mocks.syncLabsAppState).toHaveBeenCalledWith(states, true);
  });

  it("refuses an unauthenticated caller", async () => {
    await expect(action.run({ enabled: true }, {})).rejects.toThrow(
      "Not authenticated.",
    );
  });
});
