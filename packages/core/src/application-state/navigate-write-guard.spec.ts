import { describe, expect, it } from "vitest";
import { z } from "zod";

import { noteObservedWrite } from "../action-frame.js";
import { defineAction } from "../action.js";
import {
  AgentNavigationRefusedError,
  assertNavigateWriteAllowed,
  isDefaultDetailNavigation,
  withAuthorizedFrameworkUrlTool,
} from "./navigate-write-guard.js";

function inAction<T>(
  caller: "mcp" | "tool" | "a2a" | "frontend" | "cli",
  options: {
    readOnly?: boolean;
    allowsAgentNavigation?: boolean;
    intent?: string;
    actionName?: string;
  },
  fn: () => T | Promise<T>,
): Promise<T> {
  const action = defineAction({
    description: "Run a check inside an action.",
    schema: z.object({}),
    readOnly: options.readOnly,
    allowsAgentNavigation: options.allowsAgentNavigation,
    run: async () => fn(),
  });
  const input = options.intent ? { intent: options.intent } : {};
  return action.run(input as Record<string, never>, {
    caller,
    ...(options.actionName ? { actionName: options.actionName } : {}),
  }) as Promise<T>;
}

describe("isDefaultDetailNavigation", () => {
  it("recognizes item id fields and nested detail paths", () => {
    expect(isDefaultDetailNavigation({ view: "tasks", taskId: "t1" })).toBe(
      true,
    );
    expect(isDefaultDetailNavigation({ view: "inbox", threadId: "th-1" })).toBe(
      true,
    );
    expect(isDefaultDetailNavigation({ id: "item-1" })).toBe(true);
    expect(isDefaultDetailNavigation({ task_id: "t1" })).toBe(true);
    expect(isDefaultDetailNavigation({ path: "/tasks/t1" })).toBe(true);
    expect(isDefaultDetailNavigation({ path: "/page/doc_123" })).toBe(true);
    expect(isDefaultDetailNavigation({ path: "/factory?factoryId=f1" })).toBe(
      true,
    );
    expect(
      isDefaultDetailNavigation({ path: "/admin/integrations?itemId=1" }),
    ).toBe(true);
    expect(
      isDefaultDetailNavigation({
        path: "/admin/transactional-email/clips/msg-123",
      }),
    ).toBe(true);
    expect(
      isDefaultDetailNavigation({ path: "/admin/automations/auto-42" }),
    ).toBe(true);
  });

  it("treats list views, settings and admin section paths, and internal _writeId as non-detail", () => {
    expect(
      isDefaultDetailNavigation({ view: "tasks", _writeId: "123-abc" }),
    ).toBe(false);
    expect(isDefaultDetailNavigation({ path: "/tasks" })).toBe(false);
    expect(isDefaultDetailNavigation({ path: "/settings/app/rules" })).toBe(
      false,
    );
    expect(
      isDefaultDetailNavigation({ path: "/settings/integrations/slack" }),
    ).toBe(false);
    expect(isDefaultDetailNavigation({ path: "/admin/integrations" })).toBe(
      false,
    );
    expect(
      isDefaultDetailNavigation({ path: "/admin/integrations/notion" }),
    ).toBe(false);
    expect(isDefaultDetailNavigation({ path: "/admin/workspace" })).toBe(false);
    expect(
      isDefaultDetailNavigation({ path: "/admin/transactional-email" }),
    ).toBe(false);
    expect(isDefaultDetailNavigation({ path: "/tasks?includeDone=true" })).toBe(
      false,
    );
  });
});

describe("assertNavigateWriteAllowed", () => {
  it.each([
    ["mcp", "navigate"],
    ["tool", "navigate:tab-1"],
    ["a2a", "navigate"],
    ["mcp", "__set_url__"],
    ["tool", "__set_url__:tab-1"],
    ["a2a", "__set_url__"],
  ] as const)("refuses a %s read writing %s", async (caller, key) => {
    await expect(
      inAction(caller, { readOnly: true }, () =>
        assertNavigateWriteAllowed(key, { view: "tasks" }),
      ),
    ).rejects.toMatchObject({
      name: "AgentNavigationRefusedError",
      code: "agent_navigation_refused",
      message: expect.stringContaining("read-only action cannot move"),
    });
  });

  it("allows framework URL tools writing __set_url__, and refuses detail __set_url__ from normal actions", async () => {
    await expect(
      inAction("tool", { readOnly: true }, () =>
        withAuthorizedFrameworkUrlTool(() =>
          assertNavigateWriteAllowed("__set_url__:tab-1", {
            pathname: "/settings/app",
          }),
        ),
      ),
    ).resolves.toBeUndefined();

    await expect(
      inAction("mcp", { readOnly: false, actionName: "navigate" }, () =>
        assertNavigateWriteAllowed("__set_url__:tab-1", {
          pathname: "/tasks/t1",
        }),
      ),
    ).rejects.toBeInstanceOf(AgentNavigationRefusedError);

    await expect(
      inAction("mcp", { readOnly: false, actionName: "navigate" }, () =>
        assertNavigateWriteAllowed("__set_url__:tab-1", {
          pathname: "/settings/app/rules",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses a write nested inside an agent's read", async () => {
    await expect(
      inAction("mcp", { readOnly: true }, () =>
        inAction("mcp", { readOnly: false }, () =>
          assertNavigateWriteAllowed("navigate", { view: "tasks" }),
        ),
      ),
    ).rejects.toBeInstanceOf(AgentNavigationRefusedError);
  });

  it.each(["mcp", "tool", "a2a"] as const)(
    "refuses a %s detail navigate write without intent open",
    async (caller) => {
      await expect(
        inAction(caller, { readOnly: false, actionName: "navigate" }, () =>
          assertNavigateWriteAllowed("navigate:tab-1", {
            view: "tasks",
            taskId: "t1",
          }),
        ),
      ).rejects.toMatchObject({
        name: "AgentNavigationRefusedError",
        code: "agent_navigation_refused",
        message: expect.stringContaining('intent: "open"'),
      });
    },
  );

  it("allows a detail navigate write when raw input carries intent open even if the schema strips it", async () => {
    await expect(
      inAction(
        "mcp",
        { readOnly: false, actionName: "navigate", intent: "open" },
        () =>
          assertNavigateWriteAllowed("navigate:tab-1", {
            view: "tasks",
            taskId: "t1",
          }),
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses any navigate write from a top-level write action even before its first write, and after writes or in nested calls", async () => {
    await expect(
      inAction("mcp", { readOnly: false, actionName: "edit-task" }, () =>
        assertNavigateWriteAllowed("navigate", { view: "tasks" }),
      ),
    ).rejects.toMatchObject({
      name: "AgentNavigationRefusedError",
      code: "agent_navigation_refused",
      message: expect.stringContaining("write action cannot move"),
    });

    await expect(
      inAction("mcp", { readOnly: false, actionName: "navigate" }, () => {
        noteObservedWrite("sql");
        assertNavigateWriteAllowed("navigate", { view: "tasks" });
      }),
    ).rejects.toMatchObject({
      name: "AgentNavigationRefusedError",
      code: "agent_navigation_refused",
      message: expect.stringContaining("write action cannot move"),
    });

    await expect(
      inAction("mcp", { readOnly: false, actionName: "edit-task" }, () =>
        inAction("mcp", { readOnly: false, actionName: "navigate" }, () =>
          assertNavigateWriteAllowed("navigate", { view: "tasks" }),
        ),
      ),
    ).rejects.toBeInstanceOf(AgentNavigationRefusedError);
  });

  it("allows an explicit allowsAgentNavigation write action, but still refuses reads", async () => {
    await expect(
      inAction("mcp", { readOnly: false, allowsAgentNavigation: true }, () => {
        noteObservedWrite("sql");
        assertNavigateWriteAllowed("navigate", { path: "/design/d1" });
      }),
    ).resolves.toBeUndefined();

    await expect(
      inAction("mcp", { readOnly: true, allowsAgentNavigation: true }, () =>
        assertNavigateWriteAllowed("navigate", { path: "/design/d1" }),
      ),
    ).rejects.toBeInstanceOf(AgentNavigationRefusedError);
  });

  it.each([
    [
      "an agent's read of another key",
      "mcp",
      true,
      undefined,
      "navigation",
      { path: "/tasks/t1" },
    ],
    [
      "an agent's read of a similar key",
      "mcp",
      true,
      undefined,
      "navigated",
      { path: "/tasks/t1" },
    ],
    [
      "an agent's standalone list navigate",
      "mcp",
      false,
      "navigate",
      "navigate",
      { view: "tasks" },
    ],
    [
      "an agent's standalone admin section navigate",
      "mcp",
      false,
      "navigate",
      "navigate",
      { path: "/admin/integrations" },
    ],
    [
      "a person's read",
      "frontend",
      true,
      undefined,
      "navigate",
      { path: "/tasks/t1" },
    ],
    [
      "a person's detail navigate",
      "frontend",
      false,
      "navigate",
      "navigate",
      { view: "tasks", taskId: "t1" },
    ],
    ["a CLI read", "cli", true, undefined, "navigate", { path: "/tasks/t1" }],
  ] as const)(
    "allows %s",
    async (_label, caller, readOnly, actionName, key, value) => {
      await expect(
        inAction(caller, { readOnly, actionName }, () =>
          assertNavigateWriteAllowed(key, value),
        ),
      ).resolves.toBeUndefined();
    },
  );

  it("allows a write outside any action", () => {
    expect(() =>
      assertNavigateWriteAllowed("navigate", { path: "/tasks/t1" }),
    ).not.toThrow();
  });
});
