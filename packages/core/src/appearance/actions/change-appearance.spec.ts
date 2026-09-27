import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("../../application-state/script-helpers.js", () => ({
  readAppState: state.readAppState,
  writeAppState: state.writeAppState,
}));

import { ACTION_CHAT_UI_RECORD_CHANGE_RENDERER } from "../../action-ui.js";
import action from "./change-appearance.js";

describe("change-appearance action cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.readAppState.mockResolvedValue({ preset: "warm" });
    state.writeAppState.mockResolvedValue(undefined);
  });

  it("returns a card descriptor when the preset changes", async () => {
    const result = await action.run({ preset: "ocean" });

    expect(state.writeAppState).toHaveBeenCalledWith("appearance", {
      preset: "ocean",
    });
    expect(result).toMatchObject({
      preset: "ocean",
      change: {
        verb: "updated",
        kind: "appearance",
        title: "Ocean",
      },
    });
    expect(action.chatUI?.renderer).toBe(ACTION_CHAT_UI_RECORD_CHANGE_RENDERER);
    expect(action.chatUI?.when?.({}, result)).toBe(true);
  });

  it("leaves an unchanged preset as an ordinary action result", async () => {
    state.readAppState.mockResolvedValue(null);

    const result = await action.run({ preset: "default" });

    expect(result).toEqual({
      preset: "default",
      message:
        "Cleared appearance preset — back to the template's base palette.",
    });
    expect(state.writeAppState).not.toHaveBeenCalled();
    expect(action.chatUI?.when?.({}, result)).toBe(false);
  });
});
