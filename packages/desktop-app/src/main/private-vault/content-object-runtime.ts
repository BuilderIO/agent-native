import {
  PrivateVaultContentObjectTransport,
  type PrivateVaultContentObjectMetadata,
} from "./content-object-transport.js";
import {
  createPrivateVaultNativeServiceClient,
  type PrivateVaultNativeServiceClient,
} from "./native-service-client.js";

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export class PrivateVaultContentObjectRuntime {
  readonly #native: Pick<
    PrivateVaultNativeServiceClient,
    "sealContentObjectRevision" | "openContentObjectRevision"
  >;

  constructor(
    native: Pick<
      PrivateVaultNativeServiceClient,
      "sealContentObjectRevision" | "openContentObjectRevision"
    >,
  ) {
    this.#native = native;
  }

  async sealAndUpload(input: {
    readonly transport: PrivateVaultContentObjectTransport;
    readonly vaultId: string;
    readonly objectId: string;
    readonly revision: number;
    readonly plaintext: Uint8Array;
    readonly parentRevisionIds?: readonly string[];
  }): Promise<{
    readonly revisionId: string;
    readonly epoch: number;
    readonly plaintextLength: number;
    readonly ciphertextByteLength: number;
  }> {
    const sealed = await this.#native.sealContentObjectRevision({
      vaultId: input.vaultId,
      objectId: input.objectId,
      revision: input.revision,
      plaintext: input.plaintext,
    });
    const revisionId = hex(sealed.revisionId);
    try {
      const metadata = await input.transport.put({
        coordinate: {
          vaultId: sealed.vaultId,
          objectId: sealed.objectId,
          revisionId,
        },
        epoch: sealed.epoch,
        parentRevisionIds: input.parentRevisionIds,
        ciphertext: sealed.encodedRevision,
      });
      return Object.freeze({
        revisionId,
        epoch: metadata.epoch,
        plaintextLength: sealed.plaintextLength,
        ciphertextByteLength: metadata.ciphertextByteLength,
      });
    } finally {
      sealed.encodedRevision.fill(0);
    }
  }

  async downloadAndOpen(input: {
    readonly transport: PrivateVaultContentObjectTransport;
    readonly vaultId: string;
    readonly objectId: string;
    readonly revision: number;
    readonly revisionId: string;
  }): Promise<{
    readonly plaintext: Uint8Array;
    readonly epoch: number;
    readonly writerEndpointId: string;
    readonly metadata: Omit<
      PrivateVaultContentObjectMetadata,
      "vaultId" | "objectId" | "revisionId" | "serverReceivedAt"
    >;
  }> {
    const downloaded = await input.transport.get(input);
    const ciphertext = Uint8Array.from(downloaded.ciphertext);
    try {
      const opened = await this.#native.openContentObjectRevision({
        vaultId: input.vaultId,
        objectId: input.objectId,
        revision: input.revision,
        encodedRevision: ciphertext,
      });
      try {
        if (
          hex(opened.revisionId) !== input.revisionId ||
          opened.epoch !== downloaded.metadata.epoch ||
          opened.plaintextLength !== opened.plaintext.byteLength
        )
          throw new Error("object binding failed");
        return Object.freeze({
          plaintext: opened.plaintext.slice(),
          epoch: opened.epoch,
          writerEndpointId: hex(opened.writerEndpointId),
          metadata: downloaded.metadata,
        });
      } finally {
        opened.plaintext.fill(0);
      }
    } finally {
      ciphertext.fill(0);
      downloaded.ciphertext.fill(0);
    }
  }
}

export function createPrivateVaultContentObjectRuntime() {
  return new PrivateVaultContentObjectRuntime(
    createPrivateVaultNativeServiceClient(),
  );
}
