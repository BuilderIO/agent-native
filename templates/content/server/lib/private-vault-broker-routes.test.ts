import {
  decodeAncV1BrokerAckResponse,
  decodeAncV1BrokerClaimResponse,
  decodeAncV1BrokerRequestFrame,
  decodeAncV1BrokerResultResponse,
  decodeAncV1BrokerRetryResponse,
  encodeAncV1BrokerAckRequest,
  encodeAncV1BrokerClaimRequest,
  encodeAncV1BrokerRequestRequest,
  encodeAncV1BrokerResultFrame,
  encodeAncV1BrokerRetryRequest,
} from "@agent-native/core/e2ee";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setResponseHeader = vi.hoisted(() => vi.fn());
const setResponseStatus = vi.hoisted(() => vi.fn());
const readPrivateVaultBoundedBody = vi.hoisted(() => vi.fn());
const authenticatePrivateVaultBrokerRequest = vi.hoisted(() => vi.fn());
const decodePrivateVaultEndpointProofHeader = vi.hoisted(() => vi.fn());
const service = vi.hoisted(() => ({
  claim: vi.fn(),
  getRequest: vi.fn(),
  acknowledge: vi.fn(),
  retry: vi.fn(),
  submitResult: vi.fn(),
}));

vi.mock("h3", () => ({
  getHeader: (event: TestEvent, name: string) => event.headers[name],
  setResponseHeader: (...args: unknown[]) => setResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => setResponseStatus(...args),
}));
vi.mock("./private-vault-bounded-body.js", () => ({
  readPrivateVaultBoundedBody: (...args: unknown[]) =>
    readPrivateVaultBoundedBody(...args),
}));
vi.mock("./private-vault-broker-auth.js", () => ({
  authenticatePrivateVaultBrokerRequest: (...args: unknown[]) =>
    authenticatePrivateVaultBrokerRequest(...args),
  decodePrivateVaultEndpointProofHeader: (...args: unknown[]) =>
    decodePrivateVaultEndpointProofHeader(...args),
}));
vi.mock("./private-vault-jobs.js", () => ({
  PrivateVaultJobConflictError: class extends Error {},
  PrivateVaultJobNotFoundError: class extends Error {},
  privateVaultJobService: service,
}));

import { handlePrivateVaultBrokerRoute } from "./private-vault-broker-routes.js";

interface TestEvent {
  headers: Record<string, string>;
  body: Uint8Array;
}

const base = { version: 1 as const, suite: "anc/v1" as const };
const principal = {
  ownerEmail: "owner@example.com",
  orgId: "org_12345678",
  vaultId: "vault_12345678",
  endpointId: "broker_12345678",
};
const job = {
  vaultId: principal.vaultId,
  jobId: "job_12345678",
  grantId: "grant_12345678",
  recipientEndpointId: principal.endpointId,
  epoch: 1,
  algorithmId: "anc-v1-job",
  ciphertextByteLength: 3,
  issuedAt: "2026-07-18T12:00:00.000Z",
  expiresAt: "2026-07-18T12:10:00.000Z",
  state: "leased",
  retryCount: 0,
  retryAt: null,
  leaseExpiresAt: "2026-07-18T12:01:00.000Z",
  serverReceivedAt: "2026-07-18T12:00:00.000Z",
};

function event(body: Uint8Array): TestEvent {
  return {
    headers: {
      "content-length": String(body.byteLength),
      "content-type": "application/octet-stream",
      "x-anc-endpoint-proof": "proof",
    },
    body,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readPrivateVaultBoundedBody.mockImplementation((input: TestEvent) =>
    Promise.resolve(input.body),
  );
  decodePrivateVaultEndpointProofHeader.mockReturnValue({ proof: true });
  authenticatePrivateVaultBrokerRequest.mockResolvedValue(principal);
});

describe("Private Vault fixed broker routes", () => {
  it("claims only content-free job coordinates", async () => {
    service.claim.mockResolvedValue(job);
    const body = encodeAncV1BrokerClaimRequest({
      ...base,
      type: "broker-job-claim-request",
    });
    const output = await handlePrivateVaultBrokerRoute(
      event(body) as never,
      "claim",
    );
    expect(decodeAncV1BrokerClaimResponse(output as Uint8Array)).toEqual({
      ...base,
      type: "broker-job-claim-response",
      job: {
        jobId: job.jobId,
        epoch: 1,
        retryCount: 0,
        algorithmId: job.algorithmId,
        ciphertextByteLength: 3,
      },
    });
    expect(service.claim).toHaveBeenCalledWith(principal);
    expect(authenticatePrivateVaultBrokerRequest).toHaveBeenCalledWith({
      proof: { proof: true },
      method: "POST",
      path: "/api/private-vault/jobs/broker/claim",
      body,
    });
  });

  it("returns only the exact leased encrypted request", async () => {
    const ciphertext = Uint8Array.of(7, 8, 9);
    service.getRequest.mockResolvedValue({ job, ciphertext, byteLength: 3 });
    const body = encodeAncV1BrokerRequestRequest({
      ...base,
      type: "broker-job-request-request",
      jobId: job.jobId,
      retryCount: 0,
    });
    const output = await handlePrivateVaultBrokerRoute(
      event(body) as never,
      "request",
    );
    expect(decodeAncV1BrokerRequestFrame(output as Uint8Array)).toEqual({
      metadata: {
        ...base,
        type: "broker-job-request-response",
        jobId: job.jobId,
        epoch: 1,
        retryCount: 0,
        algorithmId: job.algorithmId,
        ciphertextByteLength: 3,
      },
      ciphertext,
    });
  });

  it("acknowledges and schedules retry with exact attempt fences", async () => {
    service.acknowledge.mockResolvedValue({
      ...job,
      state: "acknowledged",
    });
    const ack = encodeAncV1BrokerAckRequest({
      ...base,
      type: "broker-job-ack-request",
      jobId: job.jobId,
      retryCount: 0,
    });
    const ackOutput = await handlePrivateVaultBrokerRoute(
      event(ack) as never,
      "ack",
    );
    expect(decodeAncV1BrokerAckResponse(ackOutput as Uint8Array)).toMatchObject(
      {
        jobId: job.jobId,
        retryCount: 0,
        state: "acknowledged",
      },
    );

    const retryAt = "2026-07-18T12:02:00.000Z";
    service.retry.mockResolvedValue({
      ...job,
      state: "retry_wait",
      retryCount: 1,
      retryAt,
    });
    const retry = encodeAncV1BrokerRetryRequest({
      ...base,
      type: "broker-job-retry-request",
      jobId: job.jobId,
      retryCount: 1,
      retryAt,
    });
    const retryOutput = await handlePrivateVaultBrokerRoute(
      event(retry) as never,
      "retry",
    );
    expect(
      decodeAncV1BrokerRetryResponse(retryOutput as Uint8Array),
    ).toMatchObject({
      jobId: job.jobId,
      retryCount: 1,
      retryAt,
      state: "retry_wait",
    });
  });

  it("submits only bounded encrypted results for the authenticated vault", async () => {
    const ciphertext = Uint8Array.of(4, 5, 6);
    service.submitResult.mockResolvedValue({
      jobId: job.jobId,
      retryCount: 0,
      state: "completed",
    });
    const body = encodeAncV1BrokerResultFrame(
      {
        ...base,
        type: "broker-job-result-request",
        jobId: job.jobId,
        epoch: 1,
        retryCount: 0,
        jobHash: "11".repeat(32),
        algorithmId: job.algorithmId,
        state: "completed",
      },
      ciphertext,
    );
    const output = await handlePrivateVaultBrokerRoute(
      event(body) as never,
      "result",
    );
    expect(decodeAncV1BrokerResultResponse(output as Uint8Array)).toMatchObject(
      {
        jobId: job.jobId,
        retryCount: 0,
        state: "completed",
      },
    );
    expect(service.submitResult).toHaveBeenCalledWith(principal, {
      vaultId: principal.vaultId,
      jobId: job.jobId,
      epoch: 1,
      retryCount: 0,
      jobHash: "11".repeat(32),
      algorithmId: job.algorithmId,
      ciphertextByteLength: 3,
      state: "completed",
      ciphertext,
    });
  });

  it("rejects malformed bodies before proof or authority resolution", async () => {
    const invalid = Uint8Array.of(1, 2, 3);
    const output = await handlePrivateVaultBrokerRoute(
      event(invalid) as never,
      "claim",
    );
    expect(output).toEqual({ error: "Not found" });
    expect(setResponseStatus).toHaveBeenCalledWith(expect.anything(), 404);
    expect(authenticatePrivateVaultBrokerRequest).not.toHaveBeenCalled();
  });
});
