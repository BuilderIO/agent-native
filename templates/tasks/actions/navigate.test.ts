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

    it("requires a known view and ignores a raw path", () => {
      expect(() => navigate.schema.parse({})).toThrow();
      expect(() => navigate.schema.parse({ view: "unknown" })).toThrow();
      // `path` is no longer part of the surface, so zod strips it.
      expect(
        navigate.schema.parse({ view: "tasks", path: "/_agent-native/poll" }),
      ).toEqual({ view: "tasks" });
    });
  });

  describe("run", () => {
    it("resolves an alias to the canonical view before writing", async () => {
      await navigate.run({ view: "home" }, { caller: "cli" });

      expect(writeAppStateForCurrentTab).toHaveBeenCalledWith(
        "navigate",
        expect.objectContaining({ view: "tasks" }),
      );
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
