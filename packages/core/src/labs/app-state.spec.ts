import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("../application-state/script-helpers.js", () => mocks);

import { syncLabsAppState } from "./app-state.js";
import { _resetLabRegistryForTests, registerLabs } from "./registry.js";

const states = {
  a: { enabled: true, source: "all", mixed: false },
  b: { enabled: false, source: "choice", mixed: false },
  c: { error: "invalid-choice" },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  _resetLabRegistryForTests();
  registerLabs([{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }]);
  mocks.readAppState.mockResolvedValue(null);
});

describe("syncLabsAppState", () => {
  it("lists labs that are on, off and unreadable apart", async () => {
    await syncLabsAppState(states, true);
    expect(mocks.writeAppState).toHaveBeenCalledWith("labs", {
      showAll: true,
      on: ["a"],
      off: ["b"],
      unreadable: ["c"],
    });
  });

  it("doesn't write what is already there", async () => {
    mocks.readAppState.mockResolvedValue({
      showAll: true,
      on: ["a"],
      off: ["b"],
      unreadable: ["c"],
    });
    await syncLabsAppState(states, true);
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });
});
