import type {
  PrivateVaultContentEnrollmentTransport,
  PrivateVaultHostedEnrollmentStatus,
} from "./content-enrollment-transport.js";
import type {
  NativeActivateEnrollmentResult,
  NativeConfirmEnrollmentResult,
  NativePrepareEnrollmentResult,
} from "./native-service-client.js";

export interface PrivateVaultEnrollmentAuthorizerResult {
  readonly encoded: Uint8Array;
}

export interface PrivateVaultTrustedEnrollmentOperator {
  prepareBrokerEnrollment(
    vaultId: string,
  ): Promise<NativePrepareEnrollmentResult>;
  buildBrokerEnrollmentChallenge(input: {
    readonly vaultId: string;
  }): Promise<PrivateVaultEnrollmentAuthorizerResult>;
  confirmBrokerEnrollment(
    vaultId: string,
    challenge: Uint8Array,
  ): Promise<NativeConfirmEnrollmentResult>;
  buildBrokerEnrollmentAuthorization(input: {
    readonly vaultId: string;
    readonly challenge: Uint8Array;
  }): Promise<PrivateVaultEnrollmentAuthorizerResult>;
  activateBrokerEnrollment(
    vaultId: string,
    challenge: Uint8Array,
    authorization: Uint8Array,
  ): Promise<NativeActivateEnrollmentResult>;
}

export class PrivateVaultContentEnrollmentCoordinatorError extends Error {
  constructor() {
    super("Private Vault broker enrollment could not be completed");
    this.name = "PrivateVaultContentEnrollmentCoordinatorError";
  }
}

export class PrivateVaultContentEnrollmentRejectedError extends Error {
  constructor() {
    super("Private Vault broker enrollment was rejected at SAS comparison");
    this.name = "PrivateVaultContentEnrollmentRejectedError";
  }
}

function same(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

/**
 * Drives one same-device broker enrollment using only public ceremony bytes.
 * Candidate and endpoint secrets remain in separate native custody domains;
 * hosted Content stores the byte-stable transcript and committed control edge.
 */
export class PrivateVaultContentEnrollmentCoordinator {
  readonly #native: PrivateVaultTrustedEnrollmentOperator;
  readonly #hosted: PrivateVaultContentEnrollmentTransport;
  #tail: Promise<void> = Promise.resolve();

  constructor(input: {
    readonly native: PrivateVaultTrustedEnrollmentOperator;
    readonly hosted: PrivateVaultContentEnrollmentTransport;
  }) {
    this.#native = input.native;
    this.#hosted = input.hosted;
  }

  enroll(vaultId: string): Promise<NativeActivateEnrollmentResult> {
    return this.#enqueue(async () => {
      try {
        const prepared = await this.#native.prepareBrokerEnrollment(vaultId);
        let status = await this.#hosted.publishOffer(
          prepared.offerHash,
          prepared.offer.slice(),
        );
        status = await this.#ensureChallenge(prepared, status);
        if (!status.challenge) throw new Error();
        const challenge = status.challenge.slice();
        if (status.phase !== "committed") {
          const decision = await this.#native.confirmBrokerEnrollment(
            vaultId,
            challenge.slice(),
          );
          if (decision.state === "mismatch") {
            throw new PrivateVaultContentEnrollmentRejectedError();
          }
          const built = await this.#native.buildBrokerEnrollmentAuthorization({
            vaultId,
            challenge: challenge.slice(),
          });
          status = await this.#hosted.publishAuthorization(
            prepared.offerHash,
            prepared.offer.slice(),
            built.encoded.slice(),
          );
          if (
            status.phase !== "committed" ||
            !status.authorization ||
            !same(status.authorization, built.encoded)
          ) {
            throw new Error();
          }
        }
        if (status.phase !== "committed" || !status.authorization) {
          throw new Error();
        }
        return await this.#native.activateBrokerEnrollment(
          vaultId,
          challenge,
          status.authorization.slice(),
        );
      } catch (error) {
        if (error instanceof PrivateVaultContentEnrollmentRejectedError) {
          throw error;
        }
        throw new PrivateVaultContentEnrollmentCoordinatorError();
      }
    });
  }

  async #ensureChallenge(
    prepared: NativePrepareEnrollmentResult,
    status: PrivateVaultHostedEnrollmentStatus,
  ): Promise<PrivateVaultHostedEnrollmentStatus> {
    if (status.phase !== "offer") return status;
    const built = await this.#native.buildBrokerEnrollmentChallenge({
      vaultId: prepared.vaultId,
    });
    const challenged = await this.#hosted.publishChallenge(
      prepared.offerHash,
      prepared.offer.slice(),
      built.encoded.slice(),
    );
    if (
      challenged.phase !== "challenge" ||
      !challenged.challenge ||
      !same(challenged.challenge, built.encoded)
    ) {
      throw new Error();
    }
    return challenged;
  }

  #enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
