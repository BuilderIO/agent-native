import type { ActionSuggestion } from "@agent-native/agentkit/protocol";
import type { ActionRunContext } from "@agent-native/core/action";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrgId: vi.fn(),
  getWorkspaceUrl: vi.fn(),
  getSettings: vi.fn(),
  isLocal: vi.fn(),
  startCreation: vi.fn(),
  listWorkspaceApps: vi.fn(),
  resolveApp: vi.fn(),
  listActions: vi.fn(),
  callAction: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getBuilderWorkspaceUrl: mocks.getWorkspaceUrl,
  getRequestOrgId: mocks.getOrgId,
  getRequestUserEmail: () => "owner@example.test",
  readOrgMemberRole: () => "owner",
}));
vi.mock("../server/lib/app-creation-store.js", () => ({
  getAppCreationSettings: mocks.getSettings,
  isLocalAppCreationRuntime: mocks.isLocal,
  startWorkspaceAppCreation: mocks.startCreation,
  listWorkspaceApps: mocks.listWorkspaceApps,
}));
vi.mock("../server/lib/mcp-gateway.js", () => ({
  resolveGrantedDispatchMcpApp: mocks.resolveApp,
  listGrantedDispatchMcpAppActions: mocks.listActions,
  callGrantedDispatchMcpAppAction: mocks.callAction,
}));

import execute from "./execute-action-suggestion.js";
import propose from "./propose-action-suggestions.js";

const build = {
  id: "equipment-tracker",
  kind: "create-app",
  trigger: "new-domain",
  label: "Build an equipment tracker",
  rationale: "Track who has each item and when it is due.",
  appId: "dispatch",
  execution: {
    type: "create-app",
    domainSpec: "Track checkout and return of shared equipment.",
  },
} satisfies ActionSuggestion;

const filter = {
  id: "human-notifications",
  kind: "filter",
  trigger: "ai-narrowing",
  label: "Save human notifications",
  rationale: "See replies from people in one view.",
  appId: "workspace/mail",
  execution: {
    type: "action",
    action: "create-split",
    params: { senderType: "human" },
  },
} satisfies ActionSuggestion;

const browser = { caller: "frontend" } satisfies ActionRunContext;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getOrgId.mockReturnValue("workspace");
  mocks.getSettings.mockResolvedValue({ builderBranchingEnabled: true });
  mocks.resolveApp.mockResolvedValue({ id: filter.appId });
  mocks.listActions.mockResolvedValue([{ name: filter.execution.action }]);
  mocks.callAction.mockResolvedValue({ content: [] });
});

it("offers a no-app creation suggestion without opening an app or starting creation", async () => {
  expect(await propose.run({ suggestions: [build, build] })).toEqual({
    suggestions: [build],
  });
  expect(mocks.resolveApp).not.toHaveBeenCalled();
  expect(mocks.startCreation).not.toHaveBeenCalled();

  mocks.startCreation.mockResolvedValue({
    mode: "builder",
    url: "https://builder.example.test/branches/equipment",
  });
  expect(await execute.run({ suggestion: build }, browser)).toEqual({
    suggestionId: build.id,
    status: "accepted",
    outcome: "app-creation-started",
    url: "https://builder.example.test/branches/equipment",
  });
  expect(mocks.startCreation).toHaveBeenCalledWith({
    prompt: build.execution.domainSpec,
  });
});

it("rechecks current action access before returning an accepted receipt", async () => {
  expect(await propose.run({ suggestions: [filter] })).toEqual({
    suggestions: [filter],
  });
  mocks.listActions.mockResolvedValue([]);
  await expect(
    execute.run({ suggestion: filter }, browser),
  ).rejects.toMatchObject({
    errorCode: "action_suggestion_unavailable",
  });
  expect(mocks.callAction).not.toHaveBeenCalled();

  mocks.listActions.mockResolvedValue([{ name: filter.execution.action }]);
  expect(await execute.run({ suggestion: filter }, browser)).toEqual({
    suggestionId: filter.id,
    status: "accepted",
    outcome: "action-completed",
  });
  expect(mocks.callAction).toHaveBeenCalledExactlyOnceWith(
    filter.appId,
    filter.execution.action,
    filter.execution.params,
  );
});

it("preserves a review requirement from the existing app action path", async () => {
  const approvalReview = {
    url: "https://mail.example.test/#mcpApproval=00000000-0000-4000-8000-000000000000",
  };
  mocks.callAction.mockResolvedValue({
    isError: true,
    approvalReview,
    content: [],
  });
  await expect(
    execute.run({ suggestion: filter }, browser),
  ).rejects.toMatchObject({
    errorCode: "approval_required",
    details: { approvalReview },
  });
});

it("rejects a benign-looking suggestion when its real action is marked destructive", async () => {
  mocks.listActions.mockResolvedValue([
    { name: filter.execution.action, destructive: true },
  ]);

  expect(await propose.run({ suggestions: [filter] })).toEqual({
    suggestions: [],
  });
  await expect(
    execute.run({ suggestion: filter }, browser),
  ).rejects.toMatchObject({
    errorCode: "action_suggestion_unavailable",
  });
  expect(mocks.callAction).not.toHaveBeenCalled();
});

it("requires an explicit safe selection from actions that also offer deletion", async () => {
  const multiplexed = {
    ...filter,
    execution: { type: "action", action: "manage-splits", params: {} },
  } satisfies ActionSuggestion;
  mocks.listActions.mockResolvedValue([
    {
      name: multiplexed.execution.action,
      inputSchema: {
        properties: { operation: { enum: ["create", "delete"] } },
      },
    },
  ]);

  for (const params of [{}, { operation: "delete" }]) {
    const suggestion = {
      ...multiplexed,
      execution: { ...multiplexed.execution, params },
    };
    await expect(execute.run({ suggestion }, browser)).rejects.toMatchObject({
      errorCode: "action_suggestion_unavailable",
    });
  }
  expect(mocks.callAction).not.toHaveBeenCalled();

  const safe = {
    ...multiplexed,
    execution: { ...multiplexed.execution, params: { operation: "create" } },
  };
  expect(await propose.run({ suggestions: [safe] })).toEqual({
    suggestions: [safe],
  });
  await expect(
    execute.run({ suggestion: safe }, browser),
  ).resolves.toMatchObject({
    status: "accepted",
  });
});

it.each(["thread-delete", "deleteThread", "thread.delete"])(
  "rejects the explicit destructive token in %s",
  async (action) => {
    const suggestion = {
      ...filter,
      execution: { ...filter.execution, action },
    };
    mocks.listActions.mockResolvedValue([{ name: action }]);
    await expect(execute.run({ suggestion }, browser)).rejects.toMatchObject({
      errorCode: "action_suggestion_unavailable",
    });
    expect(mocks.callAction).not.toHaveBeenCalled();
  },
);

it("requires a safe nested selection in a mixed schema", async () => {
  const action = "manage-splits";
  mocks.listActions.mockResolvedValue([
    {
      name: action,
      inputSchema: {
        properties: {
          options: {
            properties: { operation: { enum: ["create", "bulk-delete"] } },
          },
        },
      },
    },
  ]);
  for (const params of [{}, { options: { operation: "bulk-delete" } }]) {
    const suggestion = {
      ...filter,
      execution: { type: "action" as const, action, params },
    };
    await expect(execute.run({ suggestion }, browser)).rejects.toMatchObject({
      errorCode: "action_suggestion_unavailable",
    });
  }
  expect(mocks.callAction).not.toHaveBeenCalled();
  const safe = {
    ...filter,
    execution: {
      type: "action" as const,
      action,
      params: { options: { operation: "create" } },
    },
  };
  await expect(
    execute.run({ suggestion: safe }, browser),
  ).resolves.toMatchObject({
    status: "accepted",
  });
});

it("returns an accessible existing app when creation reports its id is registered", async () => {
  mocks.startCreation.mockResolvedValue({
    mode: "app-id-taken",
    appId: "equipment",
    conflict: "registered",
  });
  mocks.listWorkspaceApps.mockResolvedValue([
    {
      id: "equipment",
      url: "https://equipment.example.test/",
      status: "ready",
    },
  ]);
  expect(await execute.run({ suggestion: build }, browser)).toEqual({
    suggestionId: build.id,
    status: "accepted",
    outcome: "action-completed",
    url: "https://equipment.example.test/",
  });
});

it("does not expose a conflicting app outside the visible workspace", async () => {
  mocks.startCreation.mockResolvedValue({
    mode: "app-id-taken",
    appId: "equipment",
    conflict: "registered",
  });
  mocks.listWorkspaceApps.mockResolvedValue([]);
  await expect(
    execute.run({ suggestion: build }, browser),
  ).rejects.toMatchObject({ errorCode: "action_suggestion_unavailable" });
});

it("treats an action whose target already exists as completed", async () => {
  mocks.callAction.mockResolvedValue({
    isError: true,
    content: [
      {
        type: "text",
        text: "Split already exists (errorCode: already_exists)",
      },
    ],
  });
  expect(await execute.run({ suggestion: filter }, browser)).toEqual({
    suggestionId: filter.id,
    status: "accepted",
    outcome: "action-completed",
  });
});

it("still fails an action that errors for another reason", async () => {
  mocks.callAction.mockResolvedValue({
    isError: true,
    content: [{ type: "text", text: "Boom (errorCode: app_failed)" }],
  });
  await expect(
    execute.run({ suggestion: filter }, browser),
  ).rejects.toMatchObject({ errorCode: "app_failed" });
});

it.each([
  ["Split already exists", "app_failed"],
  ["Boom", "duplicate_input"],
  ["Parent folder does not exist", "folder_not_exists"],
])("does not report %s (%s) as completed", async (text, code) => {
  mocks.callAction.mockResolvedValue({
    isError: true,
    content: [{ type: "text", text: `${text} (errorCode: ${code})` }],
  });
  await expect(
    execute.run({ suggestion: filter }, browser),
  ).rejects.toMatchObject({ errorCode: code });
});

it("opens the pending Builder branch when the app is already being created", async () => {
  mocks.startCreation.mockResolvedValue({
    mode: "app-id-taken",
    appId: "equipment",
    conflict: "pending",
  });
  mocks.listWorkspaceApps.mockResolvedValue([
    {
      id: "equipment",
      url: "https://builder.example.test/branches/equipment",
      status: "pending",
    },
  ]);
  expect(await execute.run({ suggestion: build }, browser)).toEqual({
    suggestionId: build.id,
    status: "accepted",
    outcome: "app-creation-started",
    url: "https://builder.example.test/branches/equipment",
  });
});
