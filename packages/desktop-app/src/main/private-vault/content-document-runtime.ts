import { createPrivateVaultContentActionRegistry } from "./content-action-registry.js";
import {
  PRIVATE_VAULT_CONTENT_TYPE,
  PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
} from "./content-document-codec.js";
import {
  type CreatePrivateDocumentInput,
  PrivateVaultContentMutations,
  type UpdatePrivateDocumentInput,
} from "./content-document-mutations.js";
import { PrivateVaultContentRegistry } from "./content-document-registry.js";
import { PrivateVaultContentSync } from "./content-document-sync.js";
import type { PrivateVaultContentSession } from "./content-genesis-transport.js";
import {
  createPrivateVaultContentObjectRuntime,
  type PrivateVaultContentObjectRuntime,
} from "./content-object-runtime.js";
import { PrivateVaultContentObjectTransport } from "./content-object-transport.js";
import {
  createEncryptedContentIndexStore,
  type EncryptedContentIndexStore,
} from "./encrypted-content-index-store.js";

type ObjectRuntimeSurface = Pick<
  PrivateVaultContentObjectRuntime,
  "sealAndUpload" | "downloadAndOpen"
>;

export class PrivateVaultContentDocumentRuntime {
  readonly #index: EncryptedContentIndexStore;
  readonly #registry: PrivateVaultContentRegistry;
  readonly #mutations: PrivateVaultContentMutations;
  readonly #sync: PrivateVaultContentSync;
  #initialized = false;

  constructor(input: {
    index: EncryptedContentIndexStore;
    transport: PrivateVaultContentObjectTransport;
    objects: ObjectRuntimeSurface;
  }) {
    this.#index = input.index;
    this.#registry = new PrivateVaultContentRegistry(input.index);
    // Keep the concrete gateway shapes here in signed Desktop composition;
    // neither the hosted app nor its remote webview receives plaintext methods.
    this.#mutations = new PrivateVaultContentMutations({
      index: input.index,
      gateway: {
        sealAndUpload: (request) =>
          input.objects.sealAndUpload({
            transport: input.transport,
            ...request,
          }),
      },
    });
    this.#sync = new PrivateVaultContentSync({
      index: input.index,
      gateway: {
        list: (vaultId) => input.transport.list(vaultId),
        open: async (request) => {
          const opened = await input.objects.downloadAndOpen({
            transport: input.transport,
            ...request,
          });
          return {
            plaintext: opened.plaintext,
            contentType:
              opened.metadata.objectType === "document"
                ? PRIVATE_VAULT_CONTENT_TYPE
                : PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
          };
        },
      },
    });
  }

  async initialize(vaultId: string): Promise<void> {
    if (this.#initialized) return;
    await this.#index.initialize();
    await this.#sync.synchronize(vaultId);
    this.#initialized = true;
  }

  async synchronize(vaultId: string) {
    this.#assertReady();
    return this.#sync.synchronize(vaultId);
  }

  async listDocuments(vaultId: string) {
    this.#assertReady();
    return this.#registry.listDocuments(vaultId);
  }

  async getDocument(vaultId: string, objectId: string) {
    this.#assertReady();
    return this.#registry.getDocument(vaultId, objectId);
  }

  async searchDocuments(vaultId: string, query: string, limit?: number) {
    this.#assertReady();
    return this.#registry.searchDocuments(vaultId, query, limit);
  }

  async listDocumentVersions(vaultId: string, objectId: string) {
    this.#assertReady();
    return this.#registry.listDocumentVersions(vaultId, objectId);
  }

  async createDocument(vaultId: string, input: CreatePrivateDocumentInput) {
    this.#assertReady();
    return this.#mutations.createDocument(vaultId, input);
  }

  async updateDocument(
    vaultId: string,
    objectId: string,
    input: UpdatePrivateDocumentInput,
  ) {
    this.#assertReady();
    return this.#mutations.updateDocument(vaultId, objectId, input);
  }

  async deleteDocument(vaultId: string, objectId: string) {
    this.#assertReady();
    return this.#mutations.deleteDocument(vaultId, objectId);
  }

  async restoreDocumentVersion(
    vaultId: string,
    objectId: string,
    revisionId: string,
  ) {
    this.#assertReady();
    return this.#mutations.restoreDocumentVersion(
      vaultId,
      objectId,
      revisionId,
    );
  }

  actionRegistry(vaultId: string) {
    this.#assertReady();
    return createPrivateVaultContentActionRegistry({
      vaultId,
      registry: this,
      mutations: this,
    });
  }

  close(): void {
    this.#index.close();
    this.#initialized = false;
  }

  #assertReady() {
    if (!this.#initialized) throw new Error("Private Content is unavailable");
  }
}

export function createPrivateVaultContentDocumentRuntime(input: {
  session: PrivateVaultContentSession;
  origin: string;
}) {
  return new PrivateVaultContentDocumentRuntime({
    index: createEncryptedContentIndexStore(),
    transport: new PrivateVaultContentObjectTransport(input),
    objects: createPrivateVaultContentObjectRuntime(),
  });
}
