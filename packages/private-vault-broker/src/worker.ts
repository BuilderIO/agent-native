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
  type AncV1BrokerClaimResponse,
} from "@agent-native/core/e2ee";

import type { AncV1CryptoProvider } from "./crypto/provider.js";
import { sodiumNativeAncV1 } from "./crypto/sodium-native.js";
import type { PrivateVaultNativeService } from "./native-service.js";
import type { SignedHostedBrokerTransport } from "./transport.js";

type ClaimedJob = NonNullable<AncV1BrokerClaimResponse["job"]>;

export type PrivateVaultBrokerWorkerOutcome =
  | { readonly state: "idle" }
  | { readonly state: "completed" | "failed"; readonly jobId: string }
  | {
      readonly state: "retry_wait";
      readonly jobId: string;
      readonly retryCount: number;
      readonly retryAt: string;
    };

export interface PrivateVaultBrokerActionExecutor {
  execute(input: {
    /** Authenticated plaintext bytes borrowed only for this local call. */
    readonly payload: Uint8Array;
    readonly jobId: string;
    readonly resourceId: Uint8Array;
    readonly operation: string;
  }): Promise<{
    readonly state: "completed" | "failed";
    readonly payload: Uint8Array;
  }>;
}

export interface PrivateVaultBrokerWorkerOptions {
  readonly vaultId: string;
  readonly endpointId: string;
  readonly native: Pick<
    PrivateVaultNativeService,
    | "recoverHostedResult"
    | "openHostedJob"
    | "sealHostedResult"
    | "acknowledgeHostedResult"
  >;
  readonly transport: Pick<
    SignedHostedBrokerTransport,
    "claim" | "request" | "ack" | "retry" | "result"
  >;
  readonly executor: PrivateVaultBrokerActionExecutor;
  readonly crypto?: AncV1CryptoProvider;
  readonly now?: () => Date;
}

export class PrivateVaultBrokerWorkerError extends Error {
  constructor() {
    super("Private Vault broker work failed");
    this.name = "PrivateVaultBrokerWorkerError";
  }
}

const base = { version: 1 as const, suite: "anc/v1" as const };

function exactIdentity(value: string): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 160) {
    throw new PrivateVaultBrokerWorkerError();
  }
  return value;
}

function sameClaim(
  claim: ClaimedJob,
  request: ReturnType<typeof decodeAncV1BrokerRequestFrame>["metadata"],
): boolean {
  return (
    claim.jobId === request.jobId &&
    claim.epoch === request.epoch &&
    claim.retryCount === request.retryCount &&
    claim.algorithmId === request.algorithmId &&
    claim.ciphertextByteLength === request.ciphertextByteLength
  );
}

export class PrivateVaultBrokerWorker {
  readonly #vaultId: string;
  readonly #endpointId: string;
  readonly #native: PrivateVaultBrokerWorkerOptions["native"];
  readonly #transport: PrivateVaultBrokerWorkerOptions["transport"];
  readonly #executor: PrivateVaultBrokerActionExecutor;
  readonly #crypto: AncV1CryptoProvider;
  readonly #now: () => Date;
  #active = false;

  constructor(options: PrivateVaultBrokerWorkerOptions) {
    this.#vaultId = exactIdentity(options.vaultId);
    this.#endpointId = exactIdentity(options.endpointId);
    this.#native = options.native;
    this.#transport = options.transport;
    this.#executor = options.executor;
    this.#crypto = options.crypto ?? sodiumNativeAncV1;
    this.#now = options.now ?? (() => new Date());
  }

  async processOnce(): Promise<PrivateVaultBrokerWorkerOutcome> {
    if (this.#active) throw new PrivateVaultBrokerWorkerError();
    this.#active = true;
    let claimed: ClaimedJob | null = null;
    let hostedResultAccepted = false;
    try {
      const recovery = await this.#native.recoverHostedResult({
        ...base,
        operation: "recoverHostedResult",
        vaultId: this.#vaultId,
        endpointId: this.#endpointId,
      });
      if (recovery.pending) {
        const pending = recovery.pending;
        try {
          const receipt = decodeAncV1BrokerResultResponse(
            await this.#transport.result(
              encodeAncV1BrokerResultFrame(
                {
                  ...base,
                  type: "broker-job-result-request",
                  jobId: pending.jobId,
                  epoch: pending.epoch,
                  retryCount: pending.retryCount,
                  jobHash: pending.jobHash,
                  algorithmId: pending.algorithmId,
                  state: pending.state,
                },
                pending.resultEnvelope,
              ),
            ),
          );
          if (
            receipt.jobId !== pending.jobId ||
            receipt.retryCount !== pending.retryCount ||
            receipt.state !== pending.state
          )
            throw new PrivateVaultBrokerWorkerError();
          const delivered = await this.#native.acknowledgeHostedResult({
            ...base,
            operation: "acknowledgeHostedResult",
            vaultId: this.#vaultId,
            endpointId: this.#endpointId,
            jobId: pending.jobId,
            jobHash: pending.jobHash,
            state: pending.state,
          });
          if (delivered.delivered !== true)
            throw new PrivateVaultBrokerWorkerError();
          return { state: pending.state, jobId: pending.jobId };
        } finally {
          this.#crypto.zeroize(pending.resultEnvelope);
        }
      }
      const claim = decodeAncV1BrokerClaimResponse(
        await this.#transport.claim(
          encodeAncV1BrokerClaimRequest({
            ...base,
            type: "broker-job-claim-request",
          }),
        ),
      );
      if (!claim.job) return { state: "idle" };
      claimed = claim.job;

      const encryptedRequest = decodeAncV1BrokerRequestFrame(
        await this.#transport.request(
          encodeAncV1BrokerRequestRequest({
            ...base,
            type: "broker-job-request-request",
            jobId: claimed.jobId,
            retryCount: claimed.retryCount,
          }),
        ),
      );
      if (!sameClaim(claimed, encryptedRequest.metadata)) {
        throw new PrivateVaultBrokerWorkerError();
      }

      const opened = await this.#native.openHostedJob({
        ...base,
        operation: "openHostedJob",
        vaultId: this.#vaultId,
        endpointId: this.#endpointId,
        jobId: claimed.jobId,
        jobEnvelope: encryptedRequest.ciphertext,
        epoch: claimed.epoch,
        retryCount: claimed.retryCount,
        algorithmId: claimed.algorithmId,
      });
      const payload = opened.jobPayload;
      if (!(payload instanceof Uint8Array)) {
        throw new PrivateVaultBrokerWorkerError();
      }
      const ack = decodeAncV1BrokerAckResponse(
        await this.#transport.ack(
          encodeAncV1BrokerAckRequest({
            ...base,
            type: "broker-job-ack-request",
            jobId: claimed.jobId,
            retryCount: claimed.retryCount,
          }),
        ),
      );
      if (
        ack.jobId !== claimed.jobId ||
        ack.retryCount !== claimed.retryCount
      ) {
        this.#crypto.zeroize(payload);
        throw new PrivateVaultBrokerWorkerError();
      }

      let executionPayload: Uint8Array | null = null;
      let sealed: Uint8Array | null = null;
      try {
        const execution = await this.#executor.execute({
          payload,
          jobId: claimed.jobId,
          resourceId: opened.resourceId,
          operation: opened.operationName,
        });
        if (!(execution.payload instanceof Uint8Array)) {
          throw new PrivateVaultBrokerWorkerError();
        }
        executionPayload = execution.payload;
        const sealedResult = await this.#native.sealHostedResult({
          ...base,
          operation: "sealHostedResult",
          vaultId: this.#vaultId,
          endpointId: this.#endpointId,
          jobId: claimed.jobId,
          jobHash: opened.jobHash,
          state: execution.state,
          resultPayload: executionPayload,
        });
        sealed = sealedResult.resultEnvelope;
        if (!(sealed instanceof Uint8Array)) {
          throw new PrivateVaultBrokerWorkerError();
        }
        const receipt = decodeAncV1BrokerResultResponse(
          await this.#transport.result(
            encodeAncV1BrokerResultFrame(
              {
                ...base,
                type: "broker-job-result-request",
                jobId: claimed.jobId,
                epoch: claimed.epoch,
                retryCount: claimed.retryCount,
                jobHash: opened.jobHash,
                algorithmId: claimed.algorithmId,
                state: execution.state,
              },
              sealed,
            ),
          ),
        );
        if (
          receipt.jobId !== claimed.jobId ||
          receipt.retryCount !== claimed.retryCount ||
          receipt.state !== execution.state
        ) {
          throw new PrivateVaultBrokerWorkerError();
        }
        hostedResultAccepted = true;
        const delivered = await this.#native.acknowledgeHostedResult({
          ...base,
          operation: "acknowledgeHostedResult",
          vaultId: this.#vaultId,
          endpointId: this.#endpointId,
          jobId: claimed.jobId,
          jobHash: opened.jobHash,
          state: execution.state,
        });
        if (delivered.delivered !== true) {
          throw new PrivateVaultBrokerWorkerError();
        }
        return { state: execution.state, jobId: claimed.jobId };
      } finally {
        this.#crypto.zeroize(payload);
        if (executionPayload) this.#crypto.zeroize(executionPayload);
        if (sealed) this.#crypto.zeroize(sealed);
      }
    } catch {
      if (!claimed) throw new PrivateVaultBrokerWorkerError();
      // The hosted relay is already terminal. Preserve the native encrypted
      // spool for startup reconciliation; never mutate that hosted job back to
      // retry_wait after its durable result receipt was returned.
      if (hostedResultAccepted) throw new PrivateVaultBrokerWorkerError();
      const nextRetryCount = claimed.retryCount + 1;
      const retryAt = new Date(
        this.#now().getTime() +
          Math.min(300_000, 1_000 * 2 ** Math.min(8, nextRetryCount)),
      ).toISOString();
      try {
        const retry = decodeAncV1BrokerRetryResponse(
          await this.#transport.retry(
            encodeAncV1BrokerRetryRequest({
              ...base,
              type: "broker-job-retry-request",
              jobId: claimed.jobId,
              retryCount: claimed.retryCount,
              retryAt,
            }),
          ),
        );
        if (
          retry.jobId !== claimed.jobId ||
          retry.retryCount !== nextRetryCount ||
          retry.retryAt !== retryAt
        ) {
          throw new Error("retry mismatch");
        }
        return {
          state: "retry_wait",
          jobId: claimed.jobId,
          retryCount: nextRetryCount,
          retryAt,
        };
      } catch {
        throw new PrivateVaultBrokerWorkerError();
      }
    } finally {
      this.#active = false;
    }
  }
}
