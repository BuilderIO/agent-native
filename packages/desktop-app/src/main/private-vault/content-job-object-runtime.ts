import {
  PRIVATE_VAULT_CONTENT_TYPE,
  PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
} from "./content-document-codec.js";
import {
  PrivateVaultContentObjectTransport,
  type PrivateVaultContentObjectMetadata,
  type PrivateVaultContentHostedObjectType,
} from "./content-object-transport.js";
import {
  createPrivateVaultNativeServiceClient,
  type NativeContentObjectJobContext,
  type PrivateVaultNativeServiceClient,
} from "./native-service-client.js";

type ContentType =
  | typeof PRIVATE_VAULT_CONTENT_TYPE
  | typeof PRIVATE_VAULT_MANIFEST_CONTENT_TYPE;

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function hostedObjectType(
  contentType: ContentType,
): PrivateVaultContentHostedObjectType {
  return contentType === PRIVATE_VAULT_CONTENT_TYPE
    ? "document"
    : "vault-manifest";
}

export class PrivateVaultContentJobObjectRuntime {
  readonly #native: Pick<
    PrivateVaultNativeServiceClient,
    "sealJobContentObjectRevision" | "openJobContentObjectRevision"
  >;

  constructor(
    native: Pick<
      PrivateVaultNativeServiceClient,
      "sealJobContentObjectRevision" | "openJobContentObjectRevision"
    >,
  ) {
    this.#native = native;
  }

  async sealAndUpload(input: {
    readonly context: NativeContentObjectJobContext;
    readonly transport: PrivateVaultContentObjectTransport;
    readonly vaultId: string;
    readonly objectId: string;
    readonly revision: number;
    readonly contentType?: ContentType;
    readonly plaintext: Uint8Array;
    readonly parentRevisionIds?: readonly string[];
  }): Promise<{ readonly revisionId: string }> {
    const contentType = input.contentType ?? PRIVATE_VAULT_CONTENT_TYPE;
    const sealed = await this.#native.sealJobContentObjectRevision({
      ...input.context,
      vaultId: input.vaultId,
      objectId: input.objectId,
      revision: input.revision,
      contentType,
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
        revision: sealed.revision,
        objectType: hostedObjectType(sealed.contentType),
        epoch: sealed.epoch,
        parentRevisionIds: input.parentRevisionIds,
        ciphertext: sealed.encodedRevision,
      });
      if (metadata.revisionId !== revisionId) throw new Error();
      return Object.freeze({ revisionId });
    } finally {
      sealed.encodedRevision.fill(0);
    }
  }

  async downloadAndOpen(input: {
    readonly context: NativeContentObjectJobContext;
    readonly transport: PrivateVaultContentObjectTransport;
    readonly vaultId: string;
    readonly objectId: string;
    readonly revisionId: string;
  }): Promise<{
    readonly plaintext: Uint8Array;
    readonly metadata: Omit<
      PrivateVaultContentObjectMetadata,
      "vaultId" | "objectId" | "revisionId" | "serverReceivedAt"
    >;
  }> {
    const downloaded = await input.transport.get(input);
    const ciphertext = Uint8Array.from(downloaded.ciphertext);
    try {
      const opened = await this.#native.openJobContentObjectRevision({
        ...input.context,
        vaultId: input.vaultId,
        objectId: input.objectId,
        revision: downloaded.metadata.revision,
        encodedRevision: ciphertext,
      });
      try {
        if (
          hex(opened.revisionId) !== input.revisionId ||
          opened.epoch !== downloaded.metadata.epoch ||
          hostedObjectType(opened.contentType) !==
            downloaded.metadata.objectType ||
          opened.plaintextLength !== opened.plaintext.byteLength
        )
          throw new Error();
        return Object.freeze({
          plaintext: opened.plaintext.slice(),
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

export function createPrivateVaultContentJobObjectRuntime() {
  return new PrivateVaultContentJobObjectRuntime(
    createPrivateVaultNativeServiceClient(),
  );
}
