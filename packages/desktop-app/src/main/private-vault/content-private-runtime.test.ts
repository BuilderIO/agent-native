import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentRuntime,
  PrivateVaultContentRuntimeError,
} from "./content-private-runtime.js";

const vaultId = "11".repeat(16);

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
  const requester = { runAction: vi.fn(async () => ({ id: "result" })) };
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
      vaultId,
      brokerState: "online",
      broker: { state: "running" },
    });
    source.broker.health.mockReturnValue({ state: "revoked" });
    expect(source.runtime.health()).toEqual({
      vaultId,
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
      vaultId,
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

  it("keeps agent jobs behind the active signed runtime lifecycle", async () => {
    const source = harness();
    await expect(
      source.runtime.runAgentAction({ actionName: "list-documents", args: {} }),
    ).rejects.toBeInstanceOf(PrivateVaultContentRuntimeError);
    await source.runtime.start();
    await expect(
      source.runtime.runAgentAction({ actionName: "list-documents", args: {} }),
    ).resolves.toEqual({ id: "result" });
    expect(source.requester.runAction).toHaveBeenCalledWith({
      actionName: "list-documents",
      args: {},
    });
    await source.runtime.stop();
    await expect(
      source.runtime.runAgentAction({ actionName: "list-documents", args: {} }),
    ).rejects.toBeInstanceOf(PrivateVaultContentRuntimeError);
  });
});
