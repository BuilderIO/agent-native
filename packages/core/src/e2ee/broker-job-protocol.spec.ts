import { describe, expect, it } from "vitest";

import {
  ANC_V1_BROKER_CONTROL_MAX_BYTES,
  ANC_V1_BROKER_JOB_FRAME_MAX_BYTES,
  ANC_V1_BROKER_RESULT_FRAME_MAX_BYTES,
  AncV1BrokerJobProtocolError,
  decodeAncV1BrokerAckRequest,
  decodeAncV1BrokerAckResponse,
  decodeAncV1BrokerClaimRequest,
  decodeAncV1BrokerClaimResponse,
  decodeAncV1BrokerRequestFrame,
  decodeAncV1BrokerRequestRequest,
  decodeAncV1BrokerResultFrame,
  decodeAncV1BrokerResultResponse,
  decodeAncV1BrokerRetryRequest,
  decodeAncV1BrokerRetryResponse,
  encodeAncV1BrokerAckRequest,
  encodeAncV1BrokerAckResponse,
  encodeAncV1BrokerClaimRequest,
  encodeAncV1BrokerClaimResponse,
  encodeAncV1BrokerRequestFrame,
  encodeAncV1BrokerRequestRequest,
  encodeAncV1BrokerResultFrame,
  encodeAncV1BrokerResultResponse,
  encodeAncV1BrokerRetryRequest,
  encodeAncV1BrokerRetryResponse,
} from "./broker-job-protocol.js";
import { E2EE_SIZE_LIMITS } from "./suite.js";

const base = { version: 1 as const, suite: "anc/v1" as const };
const job = {
  jobId: "job-12345678",
  epoch: 1,
  retryCount: 0,
  algorithmId: "anc-v1-job",
  ciphertextByteLength: 3,
};

describe("anc/v1 broker job protocol", () => {
  it("round-trips every fixed control message canonically", () => {
    const cases = [
      [
        encodeAncV1BrokerClaimRequest,
        decodeAncV1BrokerClaimRequest,
        { ...base, type: "broker-job-claim-request" as const },
      ],
      [
        encodeAncV1BrokerClaimResponse,
        decodeAncV1BrokerClaimResponse,
        { ...base, type: "broker-job-claim-response" as const, job },
      ],
      [
        encodeAncV1BrokerRequestRequest,
        decodeAncV1BrokerRequestRequest,
        {
          ...base,
          type: "broker-job-request-request" as const,
          jobId: job.jobId,
          retryCount: 0,
        },
      ],
      [
        encodeAncV1BrokerAckRequest,
        decodeAncV1BrokerAckRequest,
        {
          ...base,
          type: "broker-job-ack-request" as const,
          jobId: job.jobId,
          retryCount: 0,
        },
      ],
      [
        encodeAncV1BrokerAckResponse,
        decodeAncV1BrokerAckResponse,
        {
          ...base,
          type: "broker-job-ack-response" as const,
          jobId: job.jobId,
          retryCount: 0,
          state: "acknowledged" as const,
        },
      ],
      [
        encodeAncV1BrokerRetryRequest,
        decodeAncV1BrokerRetryRequest,
        {
          ...base,
          type: "broker-job-retry-request" as const,
          jobId: job.jobId,
          retryCount: 1,
          retryAt: "2026-07-18T12:01:00.000Z",
        },
      ],
      [
        encodeAncV1BrokerRetryResponse,
        decodeAncV1BrokerRetryResponse,
        {
          ...base,
          type: "broker-job-retry-response" as const,
          jobId: job.jobId,
          retryCount: 1,
          retryAt: "2026-07-18T12:01:00.000Z",
          state: "retry_wait" as const,
        },
      ],
      [
        encodeAncV1BrokerResultResponse,
        decodeAncV1BrokerResultResponse,
        {
          ...base,
          type: "broker-job-result-response" as const,
          jobId: job.jobId,
          retryCount: 0,
          state: "completed" as const,
        },
      ],
    ] as const;

    for (const [encode, decode, value] of cases) {
      const encoded = (encode as (input: never) => Uint8Array)(value as never);
      expect((decode as (input: Uint8Array) => unknown)(encoded)).toEqual(
        value,
      );
      expect(new TextDecoder().decode(encoded)).not.toContain("plaintext");
    }
  });

  it("round-trips exact encrypted request and result frames", () => {
    const requestCiphertext = Uint8Array.of(7, 8, 9);
    const request = encodeAncV1BrokerRequestFrame(
      {
        ...base,
        type: "broker-job-request-response",
        jobId: job.jobId,
        epoch: 1,
        retryCount: 0,
        algorithmId: job.algorithmId,
      },
      requestCiphertext,
    );
    expect(decodeAncV1BrokerRequestFrame(request)).toEqual({
      metadata: {
        ...base,
        type: "broker-job-request-response",
        ...job,
      },
      ciphertext: requestCiphertext,
    });

    const resultCiphertext = Uint8Array.of(4, 5, 6);
    const result = encodeAncV1BrokerResultFrame(
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
      resultCiphertext,
    );
    expect(decodeAncV1BrokerResultFrame(result)).toEqual({
      metadata: {
        ...base,
        type: "broker-job-result-request",
        jobId: job.jobId,
        epoch: 1,
        retryCount: 0,
        jobHash: "11".repeat(32),
        algorithmId: job.algorithmId,
        state: "completed",
        ciphertextByteLength: 3,
      },
      ciphertext: resultCiphertext,
    });
  });

  it("reserves envelope overhead above the protected payload cap", () => {
    expect(ANC_V1_BROKER_JOB_FRAME_MAX_BYTES).toBe(
      4 + ANC_V1_BROKER_CONTROL_MAX_BYTES + E2EE_SIZE_LIMITS.jobEnvelopeBytes,
    );
    expect(ANC_V1_BROKER_RESULT_FRAME_MAX_BYTES).toBe(
      4 +
        ANC_V1_BROKER_CONTROL_MAX_BYTES +
        E2EE_SIZE_LIMITS.resultEnvelopeBytes,
    );
    expect(E2EE_SIZE_LIMITS.jobEnvelopeBytes).toBeGreaterThan(
      E2EE_SIZE_LIMITS.jobPayloadBytes,
    );
    expect(E2EE_SIZE_LIMITS.resultEnvelopeBytes).toBeGreaterThan(
      E2EE_SIZE_LIMITS.resultPayloadBytes,
    );
  });

  it("rejects unknown fields, noncanonical bytes, malformed frames, and bounds", () => {
    expect(() =>
      encodeAncV1BrokerClaimRequest({
        ...base,
        type: "broker-job-claim-request",
        title: "forbidden metadata",
      } as never),
    ).toThrow(AncV1BrokerJobProtocolError);
    expect(() =>
      decodeAncV1BrokerClaimRequest(
        new TextEncoder().encode(
          '{ "suite":"anc/v1","type":"broker-job-claim-request","version":1}',
        ),
      ),
    ).toThrow(AncV1BrokerJobProtocolError);
    expect(() =>
      decodeAncV1BrokerClaimRequest(
        new Uint8Array(ANC_V1_BROKER_CONTROL_MAX_BYTES + 1),
      ),
    ).toThrow(AncV1BrokerJobProtocolError);
    expect(() => decodeAncV1BrokerRequestFrame(new Uint8Array(4))).toThrow(
      AncV1BrokerJobProtocolError,
    );
    const frame = encodeAncV1BrokerRequestFrame(
      {
        ...base,
        type: "broker-job-request-response",
        jobId: job.jobId,
        epoch: 1,
        retryCount: 0,
        algorithmId: job.algorithmId,
      },
      Uint8Array.of(1),
    );
    const trailing = new Uint8Array(frame.byteLength + 1);
    trailing.set(frame);
    expect(() => decodeAncV1BrokerRequestFrame(trailing)).toThrow(
      AncV1BrokerJobProtocolError,
    );
  });
});
