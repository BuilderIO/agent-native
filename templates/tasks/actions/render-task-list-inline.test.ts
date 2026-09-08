import { describe, expect, it } from "vitest";

import renderTaskListInline, {
  TASK_LIST_INLINE_CONTENT,
} from "./render-task-list-inline.js";

describe("render-task-list-inline", () => {
  it("defaults to open tasks only", async () => {
    const result = await renderTaskListInline.run({});

    expect(result.inlineExtension.context).toEqual({
      includeDone: false,
    });
  });

  it("returns an inline widget that uses task actions", async () => {
    const result = await renderTaskListInline.run(
      { includeDone: true },
      { caller: "cli" },
    );

    expect(result).toMatchObject({
      ok: true,
      inlineExtension: {
        mode: "transient",
        name: "Task list",
        context: { includeDone: true },
      },
    });
    expect(TASK_LIST_INLINE_CONTENT).toContain('appAction("list-tasks"');
    expect(TASK_LIST_INLINE_CONTENT).toContain('appAction("update-task"');
    expect(TASK_LIST_INLINE_CONTENT).toContain('appAction("create-task"');
  });
});
