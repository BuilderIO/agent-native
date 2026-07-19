import {
  ANC_V1_BROKER_CONTROL_MAX_BYTES,
  ANC_V1_BROKER_RESULT_FRAME_MAX_BYTES,
  decodeAncV1BrokerDisclosureRequest,
  decodeAncV1BrokerAckRequest,
  decodeAncV1BrokerClaimRequest,
  decodeAncV1BrokerRequestRequest,
  decodeAncV1BrokerResultFrame,
  decodeAncV1BrokerRetryRequest,
  encodeAncV1BrokerAckResponse,
  encodeAncV1BrokerDisclosureResponse,
  encodeAncV1BrokerClaimResponse,
  encodeAncV1BrokerRequestFrame,
  encodeAncV1BrokerResultResponse,
  encodeAncV1BrokerRetryResponse,
  verifyAncV1BrokerDisclosure,
} from "@agent-native/core/e2ee";
import {
  getHeader,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import { readPrivateVaultBoundedBody } from "./private-vault-bounded-body.js";
import {
  authenticatePrivateVaultBrokerRequest,
  decodePrivateVaultEndpointProofHeader,
} from "./private-vault-broker-auth.js";
import {
  PrivateVaultJobConflictError,
  PrivateVaultJobNotFoundError,
  privateVaultJobService,
} from "./private-vault-jobs.js";
import { privateVaultSignedDisclosureService } from "./private-vault-signed-disclosures.js";

export const PRIVATE_VAULT_BROKER_PATHS = Object.freeze({
  claim: "/api/private-vault/jobs/broker/claim",
  request: "/api/private-vault/jobs/broker/request",
  ack: "/api/private-vault/jobs/broker/ack",
  retry: "/api/private-vault/jobs/broker/retry",
  result: "/api/private-vault/jobs/broker/result",
  disclosure: "/api/private-vault/jobs/broker/disclosure",
} as const);

export type PrivateVaultBrokerRoute = keyof typeof PRIVATE_VAULT_BROKER_PATHS;

function secure(event: H3Event) {
  setResponseHeader(event, "Cache-Control", "no-store");
  setResponseHeader(event, "Referrer-Policy", "no-referrer");
  setResponseHeader(event, "X-Content-Type-Options", "nosniff");
}

function fail(event: H3Event, status: number) {
  setResponseStatus(event, status);
  return { error: status === 404 ? "Not found" : "Request unavailable" };
}

function positiveLength(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) return Number.NaN;
  return Number(value);
}

function response(event: H3Event, body: Uint8Array) {
  setResponseHeader(event, "Content-Type", "application/octet-stream");
  setResponseHeader(event, "Content-Length", String(body.byteLength));
  return body;
}

export async function handlePrivateVaultBrokerRoute(
  event: H3Event,
  route: PrivateVaultBrokerRoute,
) {
  secure(event);
  const path = PRIVATE_VAULT_BROKER_PATHS[route];
  const maximum =
    route === "result"
      ? ANC_V1_BROKER_RESULT_FRAME_MAX_BYTES
      : route === "disclosure"
        ? 96 * 1024
        : ANC_V1_BROKER_CONTROL_MAX_BYTES;
  const contentLength = positiveLength(
    getHeader(event, "content-length")?.trim() ?? "",
  );
  if (
    getHeader(event, "content-type")?.trim().toLowerCase() !==
      "application/octet-stream" ||
    !Number.isSafeInteger(contentLength) ||
    contentLength > maximum
  ) {
    return fail(event, 404);
  }
  const body = await readPrivateVaultBoundedBody(
    event,
    contentLength,
    maximum,
  ).catch(() => null);
  if (!body || body.byteLength !== contentLength) return fail(event, 404);

  try {
    const proof = decodePrivateVaultEndpointProofHeader(
      getHeader(event, "x-anc-endpoint-proof")?.trim() ?? "",
    );

    if (route === "disclosure") {
      const request = decodeAncV1BrokerDisclosureRequest(body);
      const principal = await authenticatePrivateVaultBrokerRequest({
        proof,
        method: "POST",
        path,
        body,
      });
      const verified = await verifyAncV1BrokerDisclosure({
        request,
        brokerSigningPublicKey: principal.signingPublicKey,
        nowSeconds: Math.floor(Date.now() / 1000),
      });
      await privateVaultSignedDisclosureService.append({
        principal,
        disclosure: verified,
      });
      return response(
        event,
        encodeAncV1BrokerDisclosureResponse({
          version: 1,
          suite: "anc/v1",
          type: "broker-disclosure-response",
          disclosureId: verified.disclosureId,
          state: "stored",
        }),
      );
    }

    if (route === "claim") {
      decodeAncV1BrokerClaimRequest(body);
      const principal = await authenticatePrivateVaultBrokerRequest({
        proof,
        method: "POST",
        path,
        body,
      });
      const job = await privateVaultJobService.claim(principal);
      return response(
        event,
        encodeAncV1BrokerClaimResponse({
          version: 1,
          suite: "anc/v1",
          type: "broker-job-claim-response",
          job: job
            ? {
                jobId: job.jobId,
                grantId: job.grantId,
                epoch: job.epoch,
                retryCount: job.retryCount,
                algorithmId: job.algorithmId,
                ciphertextByteLength: job.ciphertextByteLength,
              }
            : null,
        }),
      );
    }

    if (route === "request") {
      const request = decodeAncV1BrokerRequestRequest(body);
      const principal = await authenticatePrivateVaultBrokerRequest({
        proof,
        method: "POST",
        path,
        body,
      });
      const output = await privateVaultJobService.getRequest(
        principal,
        request.jobId,
      );
      if (output.job.retryCount !== request.retryCount) {
        throw new PrivateVaultJobConflictError();
      }
      return response(
        event,
        encodeAncV1BrokerRequestFrame(
          {
            version: 1,
            suite: "anc/v1",
            type: "broker-job-request-response",
            jobId: output.job.jobId,
            epoch: output.job.epoch,
            retryCount: output.job.retryCount,
            algorithmId: output.job.algorithmId,
          },
          output.ciphertext,
        ),
      );
    }

    if (route === "ack") {
      const request = decodeAncV1BrokerAckRequest(body);
      const principal = await authenticatePrivateVaultBrokerRequest({
        proof,
        method: "POST",
        path,
        body,
      });
      const job = await privateVaultJobService.acknowledge(
        principal,
        request.jobId,
        request.retryCount,
      );
      return response(
        event,
        encodeAncV1BrokerAckResponse({
          version: 1,
          suite: "anc/v1",
          type: "broker-job-ack-response",
          jobId: job.jobId,
          retryCount: job.retryCount,
          state: "acknowledged",
        }),
      );
    }

    if (route === "retry") {
      const request = decodeAncV1BrokerRetryRequest(body);
      const principal = await authenticatePrivateVaultBrokerRequest({
        proof,
        method: "POST",
        path,
        body,
      });
      const job = await privateVaultJobService.retry(
        principal,
        request.jobId,
        request.retryCount,
        request.retryAt,
      );
      return response(
        event,
        encodeAncV1BrokerRetryResponse({
          version: 1,
          suite: "anc/v1",
          type: "broker-job-retry-response",
          jobId: job.jobId,
          retryCount: job.retryCount,
          retryAt: job.retryAt ?? request.retryAt,
          state: "retry_wait",
        }),
      );
    }

    const request = decodeAncV1BrokerResultFrame(body);
    const principal = await authenticatePrivateVaultBrokerRequest({
      proof,
      method: "POST",
      path,
      body,
    });
    const result = await privateVaultJobService.submitResult(principal, {
      vaultId: principal.vaultId,
      jobId: request.metadata.jobId,
      epoch: request.metadata.epoch,
      retryCount: request.metadata.retryCount,
      jobHash: request.metadata.jobHash,
      algorithmId: request.metadata.algorithmId,
      ciphertextByteLength: request.metadata.ciphertextByteLength,
      state: request.metadata.state,
      ciphertext: request.ciphertext,
    });
    return response(
      event,
      encodeAncV1BrokerResultResponse({
        version: 1,
        suite: "anc/v1",
        type: "broker-job-result-response",
        jobId: result.jobId,
        retryCount: result.retryCount,
        state: result.state,
      }),
    );
  } catch (error) {
    if (error instanceof PrivateVaultJobConflictError) return fail(event, 409);
    if (error instanceof PrivateVaultJobNotFoundError) return fail(event, 404);
    return fail(event, 404);
  }
}
