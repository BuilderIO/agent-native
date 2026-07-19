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
    actionRegistry: vi.fn(() => actions),
  };
  const broker = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    health: vi.fn(() => ({ state: "running" })),
  };
  const factory = vi.fn(() => broker);
  return {
    actions,
    broker,
    documents,
    factory,
    runtime: new PrivateVaultContentRuntime({
      descriptor: { read: vi.fn(async () => ({ vaultId })) },
      documents: documents as never,
      broker: factory as never,
    }),
  };
}

describe("PrivateVaultContentRuntime", () => {
  it("starts documents before the broker with the same familiar registry", async () => {
    const source = harness();
    await source.runtime.start();
    expect(source.documents.initialize).toHaveBeenCalledWith(vaultId);
    expect(source.documents.actionRegistry).toHaveBeenCalledWith(vaultId);
    expect(source.factory).toHaveBeenCalledWith(source.actions);
    expect(source.runtime.health()).toEqual({
      vaultId,
      broker: { state: "running" },
    });
    await source.runtime.stop();
    expect(source.broker.stop).toHaveBeenCalledOnce();
    expect(source.documents.close).toHaveBeenCalledOnce();
  });

  it("closes document plaintext state when broker startup fails", async () => {
    const source = harness();
    source.broker.start.mockRejectedValueOnce(new Error("locked"));
    await expect(source.runtime.start()).rejects.toBeInstanceOf(
      PrivateVaultContentRuntimeError,
    );
    expect(source.documents.close).toHaveBeenCalledOnce();
    expect(source.runtime.health()).toBeNull();
  });

  it("serializes lifecycle transitions", async () => {
    const source = harness();
    const first = source.runtime.start();
    await expect(source.runtime.start()).rejects.toBeInstanceOf(
      PrivateVaultContentRuntimeError,
    );
    await first;
  });
});
