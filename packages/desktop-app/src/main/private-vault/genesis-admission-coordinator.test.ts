import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultGenesisAdmissionCoordinator,
  PrivateVaultGenesisAdmissionCoordinatorError,
  type PendingPrivateVaultGenesis,
  type PrivateVaultGenesisHostedTransport,
  type PrivateVaultTrustedGenesisOperator,
} from "./genesis-admission-coordinator.js";

const pending = (lookupId = "11".repeat(16)): PendingPrivateVaultGenesis => ({
  lookupId,
  candidate: Uint8Array.of(1, 2, 3),
});

function fixture() {
  const order: string[] = [];
  const native: PrivateVaultTrustedGenesisOperator = {
    beginTrustedGenesis: vi.fn(async () => {
      order.push("begin");
      return pending();
    }),
    listPendingGenesis: vi.fn(async () => [pending()]),
    authorizeAdmission: vi.fn(async () => {
      order.push("authorize");
      return { body: Uint8Array.of(5), proofHeader: "proof" };
    }),
    acceptAdmissionReceipt: vi.fn(async () => {
      order.push("accept");
      return {
        vaultId: "22".repeat(16),
        accountId: "account:" + "33".repeat(32),
        workspaceId: "workspace:" + "44".repeat(32),
        body: Uint8Array.of(7),
        proofHeader: "append-proof",
      };
    }),
    finalizeHostedAppend: vi.fn(async () => {
      order.push("finalize");
    }),
  };
  const hosted: PrivateVaultGenesisHostedTransport = {
    issueChallenge: vi.fn(async () => {
      order.push("challenge");
      return Uint8Array.of(4);
    }),
    admit: vi.fn(async () => {
      order.push("admit");
      return Uint8Array.of(6);
    }),
    appendGenesis: vi.fn(async () => {
      order.push("append");
      return Uint8Array.of(8);
    }),
  };
  return { native, hosted, order };
}

describe("PrivateVaultGenesisAdmissionCoordinator", () => {
  it("preserves the fixed native-account-append-finalize sequence", async () => {
    const { native, hosted, order } = fixture();
    const coordinator = new PrivateVaultGenesisAdmissionCoordinator({
      native,
      hosted,
    });
    await expect(coordinator.create()).resolves.toEqual({
      vaultId: "22".repeat(16),
      accountId: "account:" + "33".repeat(32),
      workspaceId: "workspace:" + "44".repeat(32),
    });
    expect(order).toEqual([
      "begin",
      "challenge",
      "authorize",
      "admit",
      "accept",
      "append",
      "finalize",
    ]);
  });

  it("resumes only native-reported committed ceremonies", async () => {
    const { native, hosted } = fixture();
    vi.mocked(native.listPendingGenesis).mockResolvedValue([
      pending("11".repeat(16)),
      pending("55".repeat(16)),
    ]);
    const coordinator = new PrivateVaultGenesisAdmissionCoordinator({
      native,
      hosted,
    });
    await expect(coordinator.resume()).resolves.toHaveLength(2);
    expect(native.beginTrustedGenesis).not.toHaveBeenCalled();
    expect(native.authorizeAdmission).toHaveBeenCalledTimes(2);
    expect(native.finalizeHostedAppend).toHaveBeenCalledTimes(2);
  });

  it("never finalizes local cleanup before a hosted append receipt", async () => {
    const { native, hosted } = fixture();
    vi.mocked(hosted.appendGenesis).mockRejectedValue(new Error("offline"));
    const coordinator = new PrivateVaultGenesisAdmissionCoordinator({
      native,
      hosted,
    });
    await expect(coordinator.create()).rejects.toEqual(
      new PrivateVaultGenesisAdmissionCoordinatorError(),
    );
    expect(native.finalizeHostedAppend).not.toHaveBeenCalled();
  });

  it("serializes ceremonies and permits a clean retry after failure", async () => {
    const { native, hosted, order } = fixture();
    vi.mocked(hosted.issueChallenge)
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async () => {
        order.push("challenge");
        return Uint8Array.of(4);
      });
    const coordinator = new PrivateVaultGenesisAdmissionCoordinator({
      native,
      hosted,
    });
    const first = coordinator.create();
    const second = coordinator.create();
    await expect(first).rejects.toBeInstanceOf(
      PrivateVaultGenesisAdmissionCoordinatorError,
    );
    await expect(second).resolves.toMatchObject({ vaultId: "22".repeat(16) });
    expect(native.beginTrustedGenesis).toHaveBeenCalledTimes(2);
  });
});
