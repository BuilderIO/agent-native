import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserLabStates: vi.fn(),
  getUserLabsShowAll: vi.fn(),
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

const action = (await import("./get-lab-states.js")).default;

beforeEach(() => vi.clearAllMocks());

describe("get-lab-states action", () => {
  it("returns the states and mirrors them to application state", async () => {
    const states = { a: { enabled: true, source: "all", mixed: false } };
    mocks.getUserLabStates.mockResolvedValue(states);
    mocks.getUserLabsShowAll.mockResolvedValue(true);

    await expect(
      action.run({}, { userEmail: "a@example.com", orgId: "org-1" }),
    ).resolves.toEqual(states);
    expect(mocks.getUserLabStates).toHaveBeenCalledWith("a@example.com", {
      orgId: "org-1",
    });
    expect(mocks.syncLabsAppState).toHaveBeenCalledWith(states, true);
  });
});

it("keeps get-lab-states in the app, off MCP", async () => {
  const { default: action } = await import("./get-lab-states.js");
  expect(action.mcpTool).toBe(false);
});
