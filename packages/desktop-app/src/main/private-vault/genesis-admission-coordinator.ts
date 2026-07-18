export interface PendingPrivateVaultGenesis {
  readonly lookupId: string;
  readonly candidate: Uint8Array;
}

export interface PrivateVaultEndpointAuthenticatedRequest {
  readonly body: Uint8Array;
  readonly proofHeader: string;
}

export interface PrivateVaultGenesisAdmissionResult {
  readonly vaultId: string;
  readonly accountId: string;
  readonly workspaceId: string;
}

export interface PrivateVaultTrustedGenesisOperator {
  /** Runs the trusted native mnemonic display and full-phrase confirmation. */
  beginTrustedGenesis(): Promise<PendingPrivateVaultGenesis>;
  /** Returns only locally committed ceremonies still awaiting hosted cleanup. */
  listPendingGenesis(): Promise<readonly PendingPrivateVaultGenesis[]>;
  authorizeAdmission(input: {
    readonly lookupId: string;
    readonly challenge: Uint8Array;
  }): Promise<PrivateVaultEndpointAuthenticatedRequest>;
  acceptAdmissionReceipt(input: {
    readonly lookupId: string;
    readonly challenge: Uint8Array;
    readonly receipt: Uint8Array;
  }): Promise<
    PrivateVaultGenesisAdmissionResult &
      PrivateVaultEndpointAuthenticatedRequest
  >;
  finalizeHostedAppend(input: {
    readonly lookupId: string;
    readonly receipt: Uint8Array;
  }): Promise<void>;
}

export interface PrivateVaultGenesisHostedTransport {
  issueChallenge(candidate: Uint8Array): Promise<Uint8Array>;
  admit(request: PrivateVaultEndpointAuthenticatedRequest): Promise<Uint8Array>;
  appendGenesis(
    request: PrivateVaultEndpointAuthenticatedRequest,
  ): Promise<Uint8Array>;
}

export class PrivateVaultGenesisAdmissionCoordinatorError extends Error {
  constructor() {
    super("Private Vault creation could not be completed");
    this.name = "PrivateVaultGenesisAdmissionCoordinatorError";
  }
}

/**
 * Main-process orchestration for first-device genesis.
 *
 * The main process transports only public canonical artifacts and receipts.
 * Recovery words, recovery entropy, endpoint seeds, and plaintext vault data
 * never cross this interface. Every retry begins again from native-owned
 * committed evidence, so a renderer cannot substitute a candidate or body.
 */
export class PrivateVaultGenesisAdmissionCoordinator {
  readonly #native: PrivateVaultTrustedGenesisOperator;
  readonly #hosted: PrivateVaultGenesisHostedTransport;
  #tail: Promise<void> = Promise.resolve();

  constructor(input: {
    readonly native: PrivateVaultTrustedGenesisOperator;
    readonly hosted: PrivateVaultGenesisHostedTransport;
  }) {
    this.#native = input.native;
    this.#hosted = input.hosted;
  }

  create(): Promise<PrivateVaultGenesisAdmissionResult> {
    return this.#enqueue(async () => {
      const pending = await this.#native.beginTrustedGenesis();
      return this.#complete(pending);
    });
  }

  resume(): Promise<readonly PrivateVaultGenesisAdmissionResult[]> {
    return this.#enqueue(async () => {
      const pending = await this.#native.listPendingGenesis();
      const results: PrivateVaultGenesisAdmissionResult[] = [];
      for (const ceremony of pending) {
        results.push(await this.#complete(ceremony));
      }
      return Object.freeze(results);
    });
  }

  async #complete(
    pending: PendingPrivateVaultGenesis,
  ): Promise<PrivateVaultGenesisAdmissionResult> {
    try {
      const challenge = await this.#hosted.issueChallenge(
        pending.candidate.slice(),
      );
      const admissionRequest = await this.#native.authorizeAdmission({
        lookupId: pending.lookupId,
        challenge: challenge.slice(),
      });
      const admissionReceipt = await this.#hosted.admit(admissionRequest);
      const accepted = await this.#native.acceptAdmissionReceipt({
        lookupId: pending.lookupId,
        challenge: challenge.slice(),
        receipt: admissionReceipt.slice(),
      });
      const appendReceipt = await this.#hosted.appendGenesis({
        body: accepted.body,
        proofHeader: accepted.proofHeader,
      });
      await this.#native.finalizeHostedAppend({
        lookupId: pending.lookupId,
        receipt: appendReceipt.slice(),
      });
      return Object.freeze({
        vaultId: accepted.vaultId,
        accountId: accepted.accountId,
        workspaceId: accepted.workspaceId,
      });
    } catch {
      throw new PrivateVaultGenesisAdmissionCoordinatorError();
    }
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
