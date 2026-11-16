import * as fc from "fast-check";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { checkActionProperties } from "../action-properties.js";
import { runWithRequestContext } from "../server/request-context.js";
import { createWorkspaceCredentialActions } from "./workspace-credential-actions.js";
import { WorkspaceCredentialError } from "./workspace-credentials.js";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  findCreatedConnection: vi.fn(),
  archiveCreatedConnection: vi.fn(),
}));
vi.mock("./workspace-credentials.js", async (load) => ({
  ...(await load<typeof import("./workspace-credentials.js")>()),
  createWorkspaceCredentialService: () => state,
}));
const options = {
  appId: "warehouse-action-test",
  provider: {
    id: "warehouse",
    label: "Warehouse",
    credentialKeys: [
      { key: "CREDENTIAL", label: "Credential", required: true },
    ],
  },
  validateCredentials: async () => {},
};
const input = {
  operationId: "qa-warehouse-operation",
  name: "QA Warehouse",
  secretValues: [{ key: "CREDENTIAL", secret: "flagged-source-credential" }],
};
const frontend = { caller: "frontend" as const };
beforeEach(() => {
  vi.clearAllMocks();
  state.create.mockResolvedValue({ connectionId: "created-source" });
  state.findCreatedConnection.mockResolvedValue({
    connectionId: "created-source",
  });
  state.archiveCreatedConnection.mockResolvedValue({ archived: true });
});
afterEach(() => vi.restoreAllMocks());
it("private frontend creation returns only the native connection identity", async () => {
  const actions = createWorkspaceCredentialActions(options);
  await expect(actions.create.run(input, frontend)).resolves.toEqual({
    connectionId: "created-source",
  });
  expect(state.create).toHaveBeenCalledExactlyOnceWith(input);
  for (const action of Object.values(actions)) {
    expect(action.persistInBrowser).toBe(false);
    expect(action.persistInChatHistory).toBe(false);
    expect(action.audit?.recordInputs).toBe(false);
    expect(action.uiOnly).toBe(true);
  }
});
it.each(["create", "recover", "archive"] as const)(
  "%s refuses agent calls before native storage",
  async (key) => {
    const actions = createWorkspaceCredentialActions(options);
    await expect(
      key === "create"
        ? actions.create.run(input, { caller: "tool" })
        : actions[key].run(
            { operationId: input.operationId },
            { caller: "tool" },
          ),
    ).rejects.toMatchObject({ errorCode: "ui_only_action" });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.findCreatedConnection).not.toHaveBeenCalled();
    expect(state.archiveCreatedConnection).not.toHaveBeenCalled();
  },
);
it("recovery and archive derive the target from the operation and never accept a source ID", async () => {
  const actions = createWorkspaceCredentialActions(options);
  const args = { operationId: input.operationId };
  await expect(actions.recover.run(args, frontend)).resolves.toEqual({
    connectionId: "created-source",
  });
  await expect(actions.archive.run(args, frontend)).resolves.toEqual({
    archived: true,
  });
  expect(state.findCreatedConnection).toHaveBeenCalledExactlyOnceWith(args);
  expect(state.archiveCreatedConnection).toHaveBeenCalledExactlyOnceWith(args);
  for (const action of [actions.recover, actions.archive]) {
    const invalid = { ...args, connectionId: "another-source" };
    await expect(action.run(invalid, frontend)).rejects.toThrow();
  }
  expect(state.findCreatedConnection).toHaveBeenCalledTimes(1);
  expect(state.archiveCreatedConnection).toHaveBeenCalledTimes(1);
});
it.each([
  "invalid_input",
  "forbidden",
  "validation_failed",
  "conflict",
  "refused",
  "storage_failed",
] as const)(
  "maps %s without passing through provider or storage messages",
  async (code) => {
    const failure = new WorkspaceCredentialError(code);
    failure.message = "private-provider-detail flagged-source-credential";
    state.create.mockRejectedValue(failure);
    const action = createWorkspaceCredentialActions(options).create;
    await expect(action.run(input, frontend)).rejects.toMatchObject({
      errorCode: `workspace_credential_${code}`,
    });
    try {
      await action.run(input, frontend);
    } catch (error) {
      expect(String(error)).not.toContain("private-provider-detail");
      expect(String(error)).not.toContain("flagged-source-credential");
    }
  },
);
it("unknown create outcomes stay unconfirmed and never trigger recovery or redispatch", async () => {
  state.create.mockRejectedValue(new Error("private-storage-detail"));
  const action = createWorkspaceCredentialActions(options).create;
  await expect(action.run(input, frontend)).rejects.toMatchObject({
    errorCode: "workspace_credential_storage_failed",
    statusCode: 503,
  });
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(state.findCreatedConnection).not.toHaveBeenCalled();
  expect(state.archiveCreatedConnection).not.toHaveBeenCalled();
});
it("keeps absent recovery distinct from a failed read", async () => {
  const action = createWorkspaceCredentialActions(options).recover;
  state.findCreatedConnection.mockResolvedValue(null);
  await expect(
    action.run({ operationId: input.operationId }, frontend),
  ).resolves.toBeNull();
  state.findCreatedConnection.mockRejectedValue(new Error("unreadable"));
  await expect(
    action.run({ operationId: input.operationId }, frontend),
  ).rejects.toMatchObject({ errorCode: "workspace_credential_storage_failed" });
});
it("refuses unknown create fields rather than forwarding actor or workspace overrides", async () => {
  const action = createWorkspaceCredentialActions(options).create;
  const invalid = { ...input, orgId: "other-workspace" };
  await expect(action.run(invalid, frontend)).rejects.toThrow();
  expect(state.create).not.toHaveBeenCalled();
});
it("satisfies generated action contracts at the private caller boundary", async () => {
  const actions = createWorkspaceCredentialActions(options);
  for (const action of Object.values(actions)) {
    await runWithRequestContext(
      { userEmail: "owner@example.test", orgId: "test-org" },
      () =>
        checkActionProperties(action, {
          context: { caller: "tool" },
          runs: 12,
          seed: 166,
          overrides: { "/config": fc.constant({}) },
        }),
    );
  }
});
