import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { noteObservedWrite } from "../action-frame.js";
import { defineAction } from "../action.js";
import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import {
  AgentNavigationRefusedError,
  assertNavigateWriteAllowed,
  buildAgentNavigationKeptResult,
  evaluateAgentNavigationPolicy,
  isAgentNavigationKeptResult,
  isAgentNavigationRefusedError,
  isDefaultDetailNavigation,
  navigationKeyForCommandKey,
  registerViewportModeProbe,
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
  afterEach(() => {
    resetAppConfigForTests();
  });

  it("recognizes item id fields and generic nested detail paths without hardcoded app prefixes", () => {
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
    expect(isDefaultDetailNavigation({ path: "/admin/integrations" })).toBe(
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

  it("treats list views, settings paths, and internal _writeId as non-detail", () => {
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
    expect(isDefaultDetailNavigation({ path: "/tasks?includeDone=true" })).toBe(
      false,
    );
  });

  it("uses declared per-app detailRoutes from app config instead of hardcoded /admin or /integrations special cases", () => {
    defineAppConfig({
      agent: {
        detailRoutes: [
          "/admin/transactional-email/:appId/:id",
          "/admin/automations/:id",
          "/apps/:appId/*",
        ],
      },
    });
    expect(
      isDefaultDetailNavigation({
        path: "/admin/transactional-email/clips/msg-123",
      }),
    ).toBe(true);
    expect(
      isDefaultDetailNavigation({ path: "/admin/automations/auto-42" }),
    ).toBe(true);
    expect(isDefaultDetailNavigation({ path: "/apps/mail" })).toBe(true);
    expect(isDefaultDetailNavigation({ path: "/apps/mail/inbox/item-1" })).toBe(
      true,
    );
    expect(
      isDefaultDetailNavigation({ path: "/admin/integrations?itemId=1" }),
    ).toBe(true);
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

  it("allows framework URL tools writing __set_url__, and keeps view on detail __set_url__ from navigate actions", async () => {
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
      inAction("mcp", { readOnly: false, actionName: "navigate" }, () => {
        expect(() =>
          assertNavigateWriteAllowed("__set_url__:tab-1", {
            pathname: "/tasks/t1",
          }),
        ).toThrow(AgentNavigationRefusedError);
        assertNavigateWriteAllowed("__set_url__:tab-1", {
          pathname: "/tasks/t1",
        });
      }),
    ).resolves.toMatchObject({
      kept: true,
      navigated: false,
      reason: "detail-requires-open-intent",
    });

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
    "blocks a %s detail navigate write at the store and returns a typed kept-view result from navigate",
    async (caller) => {
      await expect(
        inAction(caller, { readOnly: false, actionName: "navigate" }, () => {
          expect(() =>
            assertNavigateWriteAllowed("navigate:tab-1", {
              view: "tasks",
              taskId: "t1",
            }),
          ).toThrow(AgentNavigationRefusedError);
          assertNavigateWriteAllowed("navigate:tab-1", {
            view: "tasks",
            taskId: "t1",
          });
        }),
      ).resolves.toMatchObject({
        kept: true,
        navigated: false,
        reason: "detail-requires-open-intent",
        currentView: null,
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

  it("refuses direct navigate writes from write actions, and returns a typed kept-view result for navigate after writes or in nested calls", async () => {
    await expect(
      inAction("mcp", { readOnly: false, actionName: "edit-task" }, () =>
        assertNavigateWriteAllowed("navigate", { view: "tasks" }),
      ),
    ).rejects.toMatchObject({
      name: "AgentNavigationRefusedError",
      code: "agent_navigation_refused",
      reason: "write-keeps-view",
      message: expect.stringContaining("write action cannot move"),
    });

    await expect(
      inAction("mcp", { readOnly: false, actionName: "navigate" }, () => {
        noteObservedWrite("sql");
        expect(() =>
          assertNavigateWriteAllowed("navigate", { view: "tasks" }),
        ).toThrow(AgentNavigationRefusedError);
        assertNavigateWriteAllowed("navigate", { view: "tasks" });
      }),
    ).resolves.toMatchObject({
      kept: true,
      navigated: false,
      reason: "write-keeps-view",
      message: expect.stringContaining('intent: "open"'),
    });

    await expect(
      inAction("mcp", { readOnly: false, actionName: "navigate" }, () => {
        noteObservedWrite("sql");
        assertNavigateWriteAllowed("navigate", { eventId: "ev-1" });
      }),
    ).resolves.toMatchObject({
      kept: true,
      navigated: false,
      reason: "detail-requires-open-intent",
      message: expect.stringContaining('intent: "open"'),
    });

    await expect(
      inAction("mcp", { readOnly: false, actionName: "edit-task" }, () =>
        inAction("mcp", { readOnly: false, actionName: "navigate" }, () =>
          assertNavigateWriteAllowed("navigate", { view: "tasks" }),
        ),
      ),
    ).resolves.toMatchObject({
      kept: true,
      navigated: false,
      reason: "write-keeps-view",
    });
  });

  it("allows an explicit allowsAgentNavigation write action, but still refuses reads and nested calls inside non-allowing writes", async () => {
    await expect(
      inAction("mcp", { readOnly: false, allowsAgentNavigation: true }, () => {
        noteObservedWrite("sql");
        assertNavigateWriteAllowed("navigate", { path: "/design/d1" });
      }),
    ).resolves.toBeUndefined();

    await expect(
      inAction(
        "mcp",
        {
          readOnly: false,
          actionName: "navigate",
          allowsAgentNavigation: true,
        },
        () => {
          assertNavigateWriteAllowed("navigate", { eventId: "ev-1" });
        },
      ),
    ).resolves.toBeUndefined();

    await expect(
      inAction("mcp", { readOnly: true, allowsAgentNavigation: true }, () =>
        assertNavigateWriteAllowed("navigate", { path: "/design/d1" }),
      ),
    ).rejects.toBeInstanceOf(AgentNavigationRefusedError);

    await expect(
      inAction("mcp", { readOnly: false, actionName: "edit-task" }, () =>
        inAction(
          "mcp",
          {
            readOnly: false,
            actionName: "navigate",
            allowsAgentNavigation: true,
          },
          () => assertNavigateWriteAllowed("navigate", { eventId: "ev-1" }),
        ),
      ),
    ).resolves.toMatchObject({
      kept: true,
      navigated: false,
      reason: "write-keeps-view",
    });

    await expect(
      inAction("mcp", { readOnly: false, actionName: "edit-task" }, () =>
        inAction(
          "mcp",
          {
            readOnly: false,
            actionName: "open-draft",
            allowsAgentNavigation: true,
          },
          () => assertNavigateWriteAllowed("navigate", { draftId: "d-1" }),
        ),
      ),
    ).rejects.toMatchObject({
      name: "AgentNavigationRefusedError",
      code: "agent_navigation_refused",
      reason: "write-keeps-view",
    });
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
      "an agent's standalone settings navigate",
      "mcp",
      false,
      "navigate",
      "navigate",
      { path: "/settings/integrations" },
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

describe("kept-view result and guard helpers", () => {
  it("formats kept-view messages for view/mode, mode, view, screen, path, and empty views", () => {
    const week = buildAgentNavigationKeptResult("detail-requires-open-intent", {
      view: "calendar",
      calendarViewMode: "week",
    });
    expect(week).toEqual({
      kept: true,
      navigated: false,
      reason: "detail-requires-open-intent",
      currentView: { view: "calendar", calendarViewMode: "week" },
      message:
        'Kept the user on calendar (week) (instead of opening the item). Pass intent: "open" only if the user asked to open or switch to it.',
    });
    expect(
      buildAgentNavigationKeptResult("write-keeps-view", {
        calendarViewMode: " day ",
      }).message,
    ).toContain("Kept the user on day (after agent writes)");
    expect(
      buildAgentNavigationKeptResult("detail-requires-open-intent", {
        view: " tasks ",
      }).message,
    ).toContain("Kept the user on tasks (instead of opening the item)");
    expect(
      buildAgentNavigationKeptResult("detail-requires-open-intent", {
        screen: " inbox ",
      }).message,
    ).toContain("Kept the user on inbox (instead of opening the item)");
    expect(
      buildAgentNavigationKeptResult("detail-requires-open-intent", {
        path: " /my-issues ",
      }).message,
    ).toContain("Kept the user on /my-issues (instead of opening the item)");
    expect(
      buildAgentNavigationKeptResult("write-keeps-view", { view: "   " })
        .message,
    ).toContain("Kept the user's current view (after agent writes)");
    expect(
      buildAgentNavigationKeptResult("detail-requires-open-intent").currentView,
    ).toBeNull();
  });

  it("recognizes kept-view results and refused errors", () => {
    const kept = buildAgentNavigationKeptResult("detail-requires-open-intent");
    expect(isAgentNavigationKeptResult(kept)).toBe(true);
    expect(isAgentNavigationKeptResult(null)).toBe(false);
    expect(isAgentNavigationKeptResult("kept")).toBe(false);
    expect(isAgentNavigationKeptResult({ ...kept, kept: false })).toBe(false);
    expect(isAgentNavigationKeptResult({ ...kept, navigated: true })).toBe(
      false,
    );
    expect(isAgentNavigationKeptResult({ ...kept, reason: 123 })).toBe(false);
    expect(isAgentNavigationKeptResult({ ...kept, message: 123 })).toBe(false);

    const err = new AgentNavigationRefusedError("nope", {
      reason: "write-keeps-view",
      currentView: { view: "inbox" },
    });
    expect(isAgentNavigationRefusedError(err)).toBe(true);
    expect(err.reason).toBe("write-keeps-view");
    expect(err.currentView).toEqual({ view: "inbox" });
    expect(
      isAgentNavigationRefusedError({
        code: "agent_navigation_refused",
        reason: "detail-requires-open-intent",
      }),
    ).toBe(true);
    expect(isAgentNavigationRefusedError(new Error("other"))).toBe(false);
    expect(isAgentNavigationRefusedError(null)).toBe(false);
    expect(
      isAgentNavigationRefusedError({ code: "agent_navigation_refused" }),
    ).toBe(false);
  });

  it("maps navigate and __set_url__ command keys to their matching navigation keys", () => {
    expect(navigationKeyForCommandKey("navigate")).toBe("navigation");
    expect(navigationKeyForCommandKey("navigate:tab-1")).toBe(
      "navigation:tab-1",
    );
    expect(navigationKeyForCommandKey("__set_url__")).toBe("navigation");
    expect(navigationKeyForCommandKey("__set_url__:tab-2")).toBe(
      "navigation:tab-2",
    );
    expect(navigationKeyForCommandKey("draft")).toBeNull();
  });

  it("refuses navigation when the registered viewport mode probe reports background", () => {
    registerViewportModeProbe(() => "background");
    try {
      const refusal = evaluateAgentNavigationPolicy({
        intent: "open",
        caller: "a2a",
      });
      expect(refusal).toEqual({
        reason: "background-viewport-locked",
        message:
          "Refused: background viewport requests cannot navigate the foreground app view.",
      });
      const kept = buildAgentNavigationKeptResult(
        "background-viewport-locked",
        { view: "inbox" },
      );
      expect(kept.reason).toBe("background-viewport-locked");
      expect(kept.message).toContain("during a background viewport request");
    } finally {
      registerViewportModeProbe(() => undefined);
    }
  });
});
