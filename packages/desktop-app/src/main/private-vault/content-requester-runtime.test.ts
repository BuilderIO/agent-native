import { decodeAncV1SemanticJobPayload } from "@agent-native/core/e2ee";
import { decodePrivateVaultActionRequest } from "@agent-native/private-vault-broker";
import { describe, expect, it, vi } from "vitest";

import {
  PrivateVaultContentRequesterRuntime,
  PrivateVaultContentRequesterRuntimeError,
} from "./content-requester-runtime.js";
import {
  PrivateVaultContentRequesterTransportError,
  type PrivateVaultContentRequesterTransport,
} from "./content-requester-transport.js";
import type { PrivateVaultNativeServiceClient } from "./native-service-client.js";

const descriptor = {
  version: 1,
  suite: "anc/v1",
  state: "active",
  vaultId: "00112233445566778899aabbccddeeff",
  endpointId: "11112222333344445555666677778888",
  head: { sequence: 7, hash: "ab".repeat(32) },
} as const;
const subjectAgentId = "aa".repeat(16);

describe("Content requester runtime", () => {
  it("round-trips a normal Content action through native grant and job custody", async () => {
    let actionName = "";
    let actionArgs: unknown;
    const native = {
      createContentGrant: vi.fn(async () => ({
        version: 1,
        suite: "anc/v1",
        operation: "create_grant",
        state: "created",
        vaultId: descriptor.vaultId,
        recipientEndpointId: descriptor.endpointId,
        subjectAgentId,
        issuedAt: 1_721_131_200,
        expiresAt: 1_723_723_200,
        grantId: Uint8Array.from({ length: 16 }, () => 5),
        grantRef: Uint8Array.from({ length: 32 }, () => 6),
        grantEnvelope: Uint8Array.from([0xa1, 1, 1]),
      })),
      sealContentJob: vi.fn(async (input: { jobPayload: Uint8Array }) => {
        const semantic = decodeAncV1SemanticJobPayload(input.jobPayload);
        const action = decodePrivateVaultActionRequest(semantic.body);
        actionName = action.actionName;
        actionArgs = action.args;
        return {
          version: 1,
          suite: "anc/v1",
          operation: "seal_job",
          state: "sealed",
          vaultId: descriptor.vaultId,
          jobId: "22".repeat(16),
          recipientEndpointId: descriptor.endpointId,
          epoch: 2,
          issuedAt: 1_721_131_200,
          expiresAt: 1_721_131_800,
          algorithmId: "anc/v1",
          jobEnvelope: Uint8Array.from([0xa1, 2, 2]),
        };
      }),
      openContentResult: vi.fn(async (input: { jobId: string }) => ({
        version: 1,
        suite: "anc/v1",
        operation: "open_result",
        state: "completed",
        vaultId: descriptor.vaultId,
        jobId: input.jobId,
        jobHash: "cd".repeat(32),
        resultPayload: new TextEncoder().encode(
          '{"version":1,"type":"content-action-result","ok":true,"result":{"title":"Secret"}}',
        ),
      })),
    } as unknown as PrivateVaultNativeServiceClient;
    const getResult = vi
      .fn()
      .mockRejectedValueOnce(
        new PrivateVaultContentRequesterTransportError(404),
      )
      .mockResolvedValue({
        vaultId: descriptor.vaultId,
        jobId: "ignored",
        state: "completed",
        epoch: 2,
        jobHash: "cd".repeat(32),
        algorithmId: "anc/v1",
        ciphertext: Uint8Array.from([0xa1, 3, 3]),
      });
    const transport = {
      putGrant: vi.fn(async () => ({})),
      putJob: vi.fn(async () => ({})),
      getResult,
    } as unknown as PrivateVaultContentRequesterTransport;
    const runtime = new PrivateVaultContentRequesterRuntime({
      descriptor: { read: vi.fn(async () => descriptor) },
      native,
      transport,
      now: () => 1_721_131_200_000,
      wait: vi.fn(async () => undefined),
      pollMilliseconds: 1,
      timeoutMilliseconds: 10,
    });
    await expect(
      runtime.runAction({
        actionName: "get-document",
        args: { id: "33".repeat(16) },
        subjectAgentId,
      }),
    ).resolves.toEqual({ title: "Secret" });
    expect(actionName).toBe("get-document");
    expect(actionArgs).toEqual({ id: "33".repeat(16) });
    expect(native.createContentGrant).toHaveBeenCalledOnce();
    expect(transport.putGrant).toHaveBeenCalledOnce();
    expect(transport.putJob).toHaveBeenCalledOnce();
    expect(getResult).toHaveBeenCalledTimes(2);
    expect(native.openContentResult).toHaveBeenCalledOnce();
  });

  it("rejects unknown actions and cross-shaped resource ids before native sealing", async () => {
    const native = {
      createContentGrant: vi.fn(),
      sealContentJob: vi.fn(),
    } as unknown as PrivateVaultNativeServiceClient;
    const runtime = new PrivateVaultContentRequesterRuntime({
      descriptor: { read: vi.fn(async () => descriptor) },
      native,
      transport: {} as PrivateVaultContentRequesterTransport,
    });
    await expect(
      runtime.runAction({ actionName: "run-shell", args: {}, subjectAgentId }),
    ).rejects.toEqual(new PrivateVaultContentRequesterRuntimeError());
    await expect(
      runtime.runAction({
        actionName: "get-document",
        args: { id: "no" },
        subjectAgentId,
      }),
    ).rejects.toEqual(new PrivateVaultContentRequesterRuntimeError());
    expect(native.createContentGrant).not.toHaveBeenCalled();
    expect(native.sealContentJob).not.toHaveBeenCalled();
  });

  it("binds version actions to their existing documentId argument", async () => {
    let resourceId = "";
    const native = {
      createContentGrant: vi.fn(async () => ({
        issuedAt: 1_721_131_200,
        expiresAt: 1_723_723_200,
        grantId: Uint8Array.from({ length: 16 }, () => 5),
        grantRef: Uint8Array.from({ length: 32 }, () => 6),
        grantEnvelope: Uint8Array.from([1]),
      })),
      sealContentJob: vi.fn(async (input: { jobPayload: Uint8Array }) => {
        resourceId = Buffer.from(
          decodeAncV1SemanticJobPayload(input.jobPayload).resourceId,
        ).toString("hex");
        return {
          epoch: 2,
          issuedAt: 1_721_131_200,
          expiresAt: 1_721_131_800,
          jobEnvelope: Uint8Array.from([2]),
        };
      }),
      openContentResult: vi.fn(async () => ({
        state: "completed",
        resultPayload: new TextEncoder().encode(
          '{"version":1,"type":"content-action-result","ok":true,"result":[]}',
        ),
      })),
    } as unknown as PrivateVaultNativeServiceClient;
    const transport = {
      putGrant: vi.fn(async () => ({})),
      putJob: vi.fn(async () => ({})),
      getResult: vi.fn(async () => ({
        state: "completed",
        jobHash: "cd".repeat(32),
        ciphertext: Uint8Array.from([3]),
      })),
    } as unknown as PrivateVaultContentRequesterTransport;
    const runtime = new PrivateVaultContentRequesterRuntime({
      descriptor: { read: vi.fn(async () => descriptor) },
      native,
      transport,
      now: () => 1_721_131_200_000,
    });
    const documentId = "44".repeat(16);
    await runtime.runAction({
      actionName: "list-document-versions",
      args: { documentId },
      subjectAgentId,
    });
    expect(resourceId).toBe(documentId);
  });

  it("never shares a standing grant between different agent subjects", async () => {
    const seenAgents: string[] = [];
    const native = {
      createContentGrant: vi.fn(async (input: { subjectAgentId: string }) => {
        seenAgents.push(input.subjectAgentId);
        return {
          issuedAt: 1_721_131_200,
          expiresAt: 1_723_723_200,
          grantId: Uint8Array.from({ length: 16 }, () => seenAgents.length),
          grantRef: Uint8Array.from({ length: 32 }, () => seenAgents.length),
          grantEnvelope: Uint8Array.from([seenAgents.length]),
        };
      }),
      sealContentJob: vi.fn(async () => ({
        epoch: 2,
        issuedAt: 1_721_131_200,
        expiresAt: 1_721_131_800,
        jobEnvelope: Uint8Array.from([2]),
      })),
      openContentResult: vi.fn(async () => ({
        state: "completed",
        resultPayload: new TextEncoder().encode(
          '{"version":1,"type":"content-action-result","ok":true,"result":[]}',
        ),
      })),
    } as unknown as PrivateVaultNativeServiceClient;
    const transport = {
      putGrant: vi.fn(async () => ({})),
      putJob: vi.fn(async () => ({})),
      getResult: vi.fn(async () => ({
        state: "completed",
        jobHash: "cd".repeat(32),
        ciphertext: Uint8Array.from([3]),
      })),
    } as unknown as PrivateVaultContentRequesterTransport;
    const runtime = new PrivateVaultContentRequesterRuntime({
      descriptor: { read: vi.fn(async () => descriptor) },
      native,
      transport,
      now: () => 1_721_131_200_000,
    });
    const secondAgentId = "bb".repeat(16);
    await Promise.all([
      runtime.runAction({
        actionName: "list-documents",
        args: {},
        subjectAgentId,
      }),
      runtime.runAction({
        actionName: "list-documents",
        args: {},
        subjectAgentId: secondAgentId,
      }),
    ]);
    await runtime.runAction({
      actionName: "list-documents",
      args: {},
      subjectAgentId,
    });
    expect(seenAgents.sort()).toEqual([subjectAgentId, secondAgentId].sort());
    expect(native.createContentGrant).toHaveBeenCalledTimes(2);
  });
});
