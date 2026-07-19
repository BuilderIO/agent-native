import {
  decodeAncV1BrokerAckRequest,
  decodeAncV1BrokerClaimRequest,
  decodeAncV1BrokerRequestRequest,
  decodeAncV1BrokerResultFrame,
  decodeAncV1BrokerRetryRequest,
  encodeAncV1BrokerAckResponse,
  encodeAncV1BrokerClaimResponse,
  encodeAncV1BrokerRequestFrame,
  encodeAncV1BrokerResultResponse,
  encodeAncV1BrokerRetryResponse,
} from "@agent-native/core/e2ee";
import { describe, expect, it, vi } from "vitest";

import type { AncV1CryptoProvider } from "./crypto/provider.js";
import { sodiumNativeAncV1 } from "./crypto/sodium-native.js";
import type { PrivateVaultNativeService } from "./native-service.js";
import {
  PrivateVaultBrokerWorker,
  PrivateVaultBrokerWorkerError,
} from "./worker.js";

const base = { version: 1 as const, suite: "anc/v1" as const };
const vaultId = "vault_12345678";
const endpointId = "broker_12345678";
const jobId = "job_12345678";
const jobHash = "11".repeat(32);

function trackedCrypto() {
  const zeroize = vi.fn((value: Uint8Array) => value.fill(0));
  const crypto = Object.create(sodiumNativeAncV1) as AncV1CryptoProvider;
  Object.defineProperty(crypto, "zeroize", { value: zeroize });
  return { crypto, zeroize };
}

function successFixture() {
  const encryptedRequest = Uint8Array.of(7, 8, 9);
  const openedPayload = Uint8Array.of(1, 2, 3);
  const executionPayload = Uint8Array.of(4, 5, 6);
  const sealedResult = Uint8Array.of(10, 11, 12);
  const native = {
    recoverHostedResult: vi.fn(async () => ({
      ...base,
      operation: "recoverHostedResult" as const,
      pending: null,
    })),
    openHostedJob: vi.fn(async () => ({
      ...base,
      operation: "openHostedJob" as const,
      jobHash,
      jobPayload: openedPayload,
      resourceId: new Uint8Array(16),
      operationName: "get-document",
    })),
    sealHostedResult: vi.fn(async () => ({
      ...base,
      operation: "sealHostedResult" as const,
      resultEnvelope: sealedResult,
      disclosureEnvelope: new Uint8Array([5]),
      disclosureId: new Uint8Array(16),
      grantRef: new Uint8Array(32),
      providerId: "codex-cli",
      destination: "gpt-5.6",
      scopeHash: new Uint8Array(32),
      issuedAt: 1,
      expiresAt: 2,
    })),
    acknowledgeHostedResult: vi.fn(async () => ({
      ...base,
      operation: "acknowledgeHostedResult" as const,
      delivered: true as const,
    })),
  } as unknown as PrivateVaultNativeService;
  const transport = {
    claim: vi.fn(async (body: Uint8Array) => {
      expect(decodeAncV1BrokerClaimRequest(body)).toEqual({
        ...base,
        type: "broker-job-claim-request",
      });
      return encodeAncV1BrokerClaimResponse({
        ...base,
        type: "broker-job-claim-response",
        job: {
          jobId,
          epoch: 1,
          retryCount: 0,
          algorithmId: "anc-v1-job",
          ciphertextByteLength: encryptedRequest.byteLength,
        },
      });
    }),
    request: vi.fn(async (body: Uint8Array) => {
      expect(decodeAncV1BrokerRequestRequest(body)).toMatchObject({
        jobId,
        retryCount: 0,
      });
      return encodeAncV1BrokerRequestFrame(
        {
          ...base,
          type: "broker-job-request-response",
          jobId,
          epoch: 1,
          retryCount: 0,
          algorithmId: "anc-v1-job",
        },
        encryptedRequest,
      );
    }),
    ack: vi.fn(async (body: Uint8Array) => {
      expect(decodeAncV1BrokerAckRequest(body)).toMatchObject({
        jobId,
        retryCount: 0,
      });
      return encodeAncV1BrokerAckResponse({
        ...base,
        type: "broker-job-ack-response",
        jobId,
        retryCount: 0,
        state: "acknowledged",
      });
    }),
    retry: vi.fn(),
    result: vi.fn(async (body: Uint8Array) => {
      expect(decodeAncV1BrokerResultFrame(body)).toEqual({
        metadata: {
          ...base,
          type: "broker-job-result-request",
          jobId,
          epoch: 1,
          retryCount: 0,
          jobHash,
          algorithmId: "anc-v1-job",
          state: "completed",
          ciphertextByteLength: sealedResult.byteLength,
        },
        ciphertext: sealedResult,
      });
      return encodeAncV1BrokerResultResponse({
        ...base,
        type: "broker-job-result-response",
        jobId,
        retryCount: 0,
        state: "completed",
      });
    }),
  };
  const executor = {
    execute: vi.fn(async ({ payload }: { payload: Uint8Array }) => {
      expect(payload).toEqual(Uint8Array.of(1, 2, 3));
      return { state: "completed" as const, payload: executionPayload };
    }),
  };
  return {
    encryptedRequest,
    openedPayload,
    executionPayload,
    sealedResult,
    native,
    transport,
    executor,
  };
}

describe("PrivateVaultBrokerWorker", () => {
  it("runs the exact encrypted claim-open-ack-execute-seal-result sequence", async () => {
    const fixture = successFixture();
    const { crypto, zeroize } = trackedCrypto();
    const worker = new PrivateVaultBrokerWorker({
      vaultId,
      endpointId,
      native: fixture.native,
      transport: fixture.transport,
      executor: fixture.executor,
      crypto,
    });

    await expect(worker.processOnce()).resolves.toEqual({
      state: "completed",
      jobId,
    });
    expect(fixture.native.openHostedJob).toHaveBeenCalledWith({
      ...base,
      operation: "openHostedJob",
      vaultId,
      endpointId,
      jobId,
      jobEnvelope: fixture.encryptedRequest,
      epoch: 1,
      retryCount: 0,
      algorithmId: "anc-v1-job",
    });
    expect(fixture.executor.execute).toHaveBeenCalledWith({
      payload: fixture.openedPayload,
      jobId,
      jobHash,
      resourceId: new Uint8Array(16),
      operation: "get-document",
    });
    expect(fixture.native.recoverHostedResult).toHaveBeenCalledWith({
      ...base,
      operation: "recoverHostedResult",
      vaultId,
      endpointId,
    });
    expect(fixture.native.sealHostedResult).toHaveBeenCalledWith({
      ...base,
      operation: "sealHostedResult",
      vaultId,
      endpointId,
      jobId,
      jobHash,
      state: "completed",
      resultPayload: fixture.executionPayload,
    });
    expect(fixture.native.acknowledgeHostedResult).toHaveBeenCalledWith({
      ...base,
      operation: "acknowledgeHostedResult",
      vaultId,
      endpointId,
      jobId,
      jobHash,
      state: "completed",
    });
    expect(zeroize).toHaveBeenCalledWith(fixture.openedPayload);
    expect(zeroize).toHaveBeenCalledWith(fixture.executionPayload);
    expect(zeroize).toHaveBeenCalledWith(fixture.sealedResult);
    expect(fixture.openedPayload).toEqual(new Uint8Array(3));
    expect(fixture.executionPayload).toEqual(new Uint8Array(3));
    expect(fixture.sealedResult).toEqual(new Uint8Array(3));
    expect(fixture.transport.retry).not.toHaveBeenCalled();
  });

  it("returns idle without opening native custody when no job exists", async () => {
    const transport = {
      claim: vi.fn(async () =>
        encodeAncV1BrokerClaimResponse({
          ...base,
          type: "broker-job-claim-response",
          job: null,
        }),
      ),
      request: vi.fn(),
      ack: vi.fn(),
      retry: vi.fn(),
      result: vi.fn(),
    };
    const native = {
      recoverHostedResult: vi.fn(async () => ({
        ...base,
        operation: "recoverHostedResult" as const,
        pending: null,
      })),
      openHostedJob: vi.fn(),
    } as never;
    const worker = new PrivateVaultBrokerWorker({
      vaultId,
      endpointId,
      native,
      transport,
      executor: { execute: vi.fn() },
    });
    await expect(worker.processOnce()).resolves.toEqual({ state: "idle" });
    expect(native.openHostedJob).not.toHaveBeenCalled();
  });

  it("moves failed local work to an exact bounded retry", async () => {
    const fixture = successFixture();
    fixture.executor.execute.mockRejectedValue(new Error("local failure"));
    fixture.transport.retry.mockImplementation(async (body: Uint8Array) => {
      const retry = decodeAncV1BrokerRetryRequest(body);
      expect(retry).toMatchObject({ jobId, retryCount: 0 });
      return encodeAncV1BrokerRetryResponse({
        ...base,
        type: "broker-job-retry-response",
        jobId,
        retryCount: 1,
        retryAt: retry.retryAt,
        state: "retry_wait",
      });
    });
    const { crypto } = trackedCrypto();
    const worker = new PrivateVaultBrokerWorker({
      vaultId,
      endpointId,
      native: fixture.native,
      transport: fixture.transport,
      executor: fixture.executor,
      crypto,
      now: () => new Date("2026-07-18T12:00:00.000Z"),
    });
    await expect(worker.processOnce()).resolves.toEqual({
      state: "retry_wait",
      jobId,
      retryCount: 1,
      retryAt: "2026-07-18T12:00:02.000Z",
    });
    expect(fixture.transport.result).not.toHaveBeenCalled();
  });

  it("preserves the encrypted spool when local receipt acknowledgment fails", async () => {
    const fixture = successFixture();
    fixture.native.acknowledgeHostedResult = vi.fn(async () => {
      throw new Error("native receipt commit failed");
    });
    const worker = new PrivateVaultBrokerWorker({
      vaultId,
      endpointId,
      native: fixture.native,
      transport: fixture.transport,
      executor: fixture.executor,
    });
    await expect(worker.processOnce()).rejects.toEqual(
      new PrivateVaultBrokerWorkerError(),
    );
    expect(fixture.transport.result).toHaveBeenCalledOnce();
    expect(fixture.transport.retry).not.toHaveBeenCalled();
  });

  it("resubmits a pending encrypted result before claiming or executing", async () => {
    const fixture = successFixture();
    const pendingEnvelope = Uint8Array.of(41, 42, 43);
    fixture.native.recoverHostedResult.mockResolvedValueOnce({
      ...base,
      operation: "recoverHostedResult",
      pending: {
        jobId,
        jobHash,
        state: "completed",
        epoch: 1,
        retryCount: 0,
        algorithmId: "anc-v1-job",
        resultEnvelope: pendingEnvelope,
      },
    });
    fixture.transport.result.mockImplementationOnce(async (body) => {
      expect(decodeAncV1BrokerResultFrame(body).ciphertext).toEqual(
        pendingEnvelope,
      );
      return encodeAncV1BrokerResultResponse({
        ...base,
        type: "broker-job-result-response",
        jobId,
        retryCount: 0,
        state: "completed",
      });
    });
    const worker = new PrivateVaultBrokerWorker({
      vaultId,
      endpointId,
      native: fixture.native,
      transport: fixture.transport,
      executor: fixture.executor,
    });
    await expect(worker.processOnce()).resolves.toEqual({
      state: "completed",
      jobId,
    });
    expect(fixture.transport.claim).not.toHaveBeenCalled();
    expect(fixture.executor.execute).not.toHaveBeenCalled();
    expect(fixture.native.openHostedJob).not.toHaveBeenCalled();
    expect(fixture.transport.result).toHaveBeenCalledOnce();
    expect(fixture.native.acknowledgeHostedResult).toHaveBeenCalledOnce();
    expect(pendingEnvelope).toEqual(new Uint8Array(3));
  });

  it("rejects concurrent work and mismatched hosted coordinates", async () => {
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = successFixture();
    fixture.transport.claim.mockImplementation(async () => {
      await delayed;
      return encodeAncV1BrokerClaimResponse({
        ...base,
        type: "broker-job-claim-response",
        job: null,
      });
    });
    const worker = new PrivateVaultBrokerWorker({
      vaultId,
      endpointId,
      native: fixture.native,
      transport: fixture.transport,
      executor: fixture.executor,
    });
    const first = worker.processOnce();
    await expect(worker.processOnce()).rejects.toBeInstanceOf(
      PrivateVaultBrokerWorkerError,
    );
    release();
    await expect(first).resolves.toEqual({ state: "idle" });
  });
});
