import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentRuntime,
  PrivateVaultContentRuntimeError,
} from "./content-private-runtime.js";

const vaultId = "11".repeat(16);
const subjectAgentId = "22".repeat(16);

function harness() {
  const actions = { "list-documents": { run: vi.fn() } };
  const documents = {
    initialize: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  const brokerActions = { create: vi.fn(async () => actions) };
  const broker = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    health: vi.fn(() => ({ state: "running" })),
  };
  const factory = vi.fn(() => broker);
  const requester = {
    runAction: vi.fn(async () => ({ id: "result" })),
    listContentGrants: vi.fn(async () => ({ grants: [] })),
    listVaultMembers: vi.fn(async () => ({ members: [] })),
    revokeContentGrant: vi.fn(async (_vaultId: string, grantRef: string) => ({
      state: "revoked",
      grantRef,
    })),
  };
  return {
    actions,
    broker,
    documents,
    brokerActions,
    factory,
    requester,
    runtime: new PrivateVaultContentRuntime({
      descriptor: { read: vi.fn(async () => ({ vaultId })) },
      documents: documents as never,
      brokerActions,
      broker: factory as never,
      requester,
    }),
  };
}

describe("PrivateVaultContentRuntime", () => {
  it("starts documents before a separately constructed broker registry", async () => {
    const source = harness();
    await source.runtime.start();
    expect(source.documents.initialize).toHaveBeenCalledWith(vaultId);
    expect(source.brokerActions.create).toHaveBeenCalledWith(vaultId);
    expect(source.factory).toHaveBeenCalledWith(source.actions);
    expect(source.runtime.health()).toEqual({
      brokerState: "online",
      broker: { state: "running" },
    });
    source.broker.health.mockReturnValue({ state: "revoked" });
    expect(source.runtime.health()).toEqual({
      brokerState: "offline",
      broker: { state: "revoked" },
    });
    await source.runtime.stop();
    expect(source.broker.stop).toHaveBeenCalledOnce();
    expect(source.documents.close).toHaveBeenCalledOnce();
  });

  it("keeps endpoint documents open while a failed broker stays offline", async () => {
    const source = harness();
    source.broker.start.mockRejectedValueOnce(new Error("locked"));
    await expect(source.runtime.start()).resolves.toBeUndefined();
    expect(source.documents.close).not.toHaveBeenCalled();
    expect(source.runtime.health()).toEqual({
      brokerState: "offline",
      broker: null,
    });
  });

  it("serializes lifecycle transitions", async () => {
    const source = harness();
    const first = source.runtime.start();
    await expect(source.runtime.start()).rejects.toBeInstanceOf(
      PrivateVaultContentRuntimeError,
    );
    await first;
  });

  it("lets trusted agent and UI startup converge on one transition", async () => {
    const source = harness();
    const first = source.runtime.ensureStarted();
    const second = source.runtime.ensureStarted();
    await Promise.all([first, second]);
    await source.runtime.ensureStarted();
    expect(source.documents.initialize).toHaveBeenCalledOnce();
  });

  it("keeps agent jobs behind the active signed runtime lifecycle", async () => {
    const source = harness();
    await expect(
      source.runtime.runAgentAction({
        actionName: "list-documents",
        args: {},
        subjectAgentId,
      }),
    ).rejects.toBeInstanceOf(PrivateVaultContentRuntimeError);
    await source.runtime.start();
    expect(source.runtime.applicationState()).toEqual({ view: "list" });
    source.runtime.setApplicationState({
      view: "editor",
      documentId: "33".repeat(16),
    });
    await expect(
      source.runtime.runAgentAction({
        actionName: "view-screen",
        args: {},
        subjectAgentId,
      }),
    ).resolves.toEqual({
      view: "editor",
      documentId: "33".repeat(16),
    });
    expect(source.requester.runAction).not.toHaveBeenCalled();
    await expect(
      source.runtime.runAgentAction({
        actionName: "list-documents",
        args: {},
        subjectAgentId,
      }),
    ).resolves.toEqual({ id: "result" });
    expect(source.requester.runAction).toHaveBeenCalledWith({
      actionName: "list-documents",
      args: {},
      subjectAgentId,
    });
    await source.runtime.stop();
    await expect(
      source.runtime.runAgentAction({
        actionName: "list-documents",
        args: {},
        subjectAgentId,
      }),
    ).rejects.toBeInstanceOf(PrivateVaultContentRuntimeError);
  });

  it("keeps grant inventory and revocation behind the active signed runtime", async () => {
    const source = harness();
    const grantRef = "33".repeat(32);
    await expect(source.runtime.listAgentGrants()).rejects.toBeInstanceOf(
      PrivateVaultContentRuntimeError,
    );
    await source.runtime.start();
    await expect(source.runtime.listAgentGrants()).resolves.toEqual({
      grants: [],
    });
    await expect(source.runtime.listVaultMembers()).resolves.toEqual({
      members: [],
    });
    await expect(source.runtime.revokeAgentGrant(grantRef)).resolves.toEqual({
      state: "revoked",
      grantRef,
    });
    expect(source.requester.listContentGrants).toHaveBeenCalledWith(vaultId);
    expect(source.requester.listVaultMembers).toHaveBeenCalledWith(vaultId);
    expect(source.requester.revokeContentGrant).toHaveBeenCalledWith(
      vaultId,
      grantRef,
    );
  });
});
