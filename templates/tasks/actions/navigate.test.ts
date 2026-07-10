import { beforeEach, describe, expect, it, vi } from "vitest";

const { writeAppStateForCurrentTab } = vi.hoisted(() => ({
  writeAppStateForCurrentTab: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppStateForCurrentTab,
}));

import navigate from "./navigate.js";

describe("navigate", () => {
  beforeEach(() => {
    writeAppStateForCurrentTab.mockReset();
    writeAppStateForCurrentTab.mockResolvedValue(undefined);
  });

  describe("schema", () => {
    it("accepts tasks navigation commands", () => {
      expect(
        navigate.schema.parse({
          view: "tasks",
          includeDone: true,
          taskId: "abc",
        }),
      ).toEqual({
        view: "tasks",
        includeDone: true,
        taskId: "abc",
      });
      expect(
        navigate.schema.parse({ view: "tasks", includeDone: "true" }),
      ).toEqual({
        view: "tasks",
        includeDone: true,
      });
    });
  });

  describe("run", () => {
    it("requires view or path", async () => {
      await expect(navigate.run({}, { caller: "cli" })).rejects.toThrow(
        /view or --path/i,
      );
      expect(writeAppStateForCurrentTab).not.toHaveBeenCalled();
    });

    it("writes task navigation state for /tasks", async () => {
      await navigate.run(
        { view: "tasks", taskId: "abc", includeDone: true },
        { caller: "cli" },
      );

      expect(writeAppStateForCurrentTab).toHaveBeenCalledWith(
        "navigate",
        expect.objectContaining({
          view: "tasks",
          taskId: "abc",
          includeDone: true,
          _writeId: expect.any(String),
        }),
      );
    });
  });
});
