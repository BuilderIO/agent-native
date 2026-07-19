import { randomBytes } from "node:crypto";

import {
  encodePrivateVaultContentDocument,
  encodePrivateVaultContentManifest,
  PRIVATE_VAULT_CONTENT_TYPE,
  PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
  privateVaultContentDocumentSchema,
  type PrivateVaultContentDocument,
  type PrivateVaultContentManifest,
  type PrivateVaultLocalManifestHead,
} from "./content-document-codec.js";
import type { EncryptedContentIndexStore } from "./encrypted-content-index-store.js";

export class PrivateVaultContentMutationError extends Error {
  constructor() {
    super("Private Content mutation unavailable");
    this.name = "PrivateVaultContentMutationError";
  }
}

export interface PrivateVaultContentObjectGateway {
  sealAndUpload(input: {
    readonly vaultId: string;
    readonly objectId: string;
    readonly revision: number;
    readonly contentType:
      | typeof PRIVATE_VAULT_CONTENT_TYPE
      | typeof PRIVATE_VAULT_MANIFEST_CONTENT_TYPE;
    readonly plaintext: Uint8Array;
    readonly parentRevisionIds: readonly string[];
  }): Promise<{ readonly revisionId: string }>;
}

type ContentIndexMutationSurface = Pick<
  EncryptedContentIndexStore,
  "readManifest" | "readDocument" | "writeDocument" | "writeManifest"
>;

export interface CreatePrivateDocumentInput {
  readonly id?: string;
  readonly title: string;
  readonly content?: string;
  readonly description?: string | null;
  readonly parentId?: string | null;
  readonly icon?: string | null;
  readonly position?: number;
  readonly isFavorite?: boolean;
  readonly hideFromSearch?: boolean;
}

export interface UpdatePrivateDocumentInput {
  readonly title?: string;
  readonly content?: string;
  readonly description?: string | null;
  readonly parentId?: string | null;
  readonly icon?: string | null;
  readonly position?: number;
  readonly isFavorite?: boolean;
  readonly hideFromSearch?: boolean;
}

function randomOpaqueId(): string {
  return randomBytes(16).toString("hex");
}

export class PrivateVaultContentMutations {
  readonly #gateway: PrivateVaultContentObjectGateway;
  readonly #index: ContentIndexMutationSurface;
  readonly #now: () => string;
  readonly #objectId: () => string;
  readonly #tails = new Map<string, Promise<void>>();

  constructor(input: {
    gateway: PrivateVaultContentObjectGateway;
    index: ContentIndexMutationSurface;
    now?: () => string;
    objectId?: () => string;
  }) {
    this.#gateway = input.gateway;
    this.#index = input.index;
    this.#now = input.now ?? (() => new Date().toISOString());
    this.#objectId = input.objectId ?? randomOpaqueId;
  }

  createDocument(
    vaultId: string,
    input: CreatePrivateDocumentInput,
  ): Promise<PrivateVaultContentDocument> {
    return this.#serialize(vaultId, async () => {
      const head = await this.#index.readManifest(vaultId);
      const objectId = input.id ?? this.#objectId();
      if (head?.manifest.documents.some((entry) => entry.objectId === objectId))
        throw new PrivateVaultContentMutationError();
      if (
        input.parentId &&
        !head?.manifest.documents.some(
          (entry) => entry.objectId === input.parentId,
        )
      )
        throw new PrivateVaultContentMutationError();
      const occurredAt = this.#now();
      const document = privateVaultContentDocumentSchema.parse({
        version: 1,
        kind: "content-document",
        id: objectId,
        parentId: input.parentId ?? null,
        title: input.title,
        content: input.content ?? "",
        description: input.description ?? null,
        icon: input.icon ?? null,
        position:
          input.position ??
          (await this.#nextPosition(vaultId, head, input.parentId)),
        isFavorite: input.isFavorite ?? false,
        hideFromSearch: input.hideFromSearch ?? false,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      });
      return this.#commitDocument(vaultId, head, document, 1, []);
    });
  }

  updateDocument(
    vaultId: string,
    objectId: string,
    input: UpdatePrivateDocumentInput,
  ): Promise<PrivateVaultContentDocument> {
    return this.#serialize(vaultId, async () => {
      const head = await this.#requireHead(vaultId);
      const entry = head.manifest.documents.find(
        (candidate) => candidate.objectId === objectId,
      );
      const latest = entry?.revisions.at(-1);
      if (!entry || !latest) throw new PrivateVaultContentMutationError();
      const current = await this.#index.readDocument(
        vaultId,
        objectId,
        latest.revisionId,
      );
      if (!current) throw new PrivateVaultContentMutationError();
      const parentId =
        input.parentId === undefined ? current.parentId : input.parentId;
      if (
        parentId &&
        !head.manifest.documents.some(
          (candidate) => candidate.objectId === parentId,
        )
      )
        throw new PrivateVaultContentMutationError();
      const document = privateVaultContentDocumentSchema.parse({
        ...current,
        ...input,
        parentId,
        updatedAt: this.#now(),
      });
      await this.#assertAcyclicMove(vaultId, head.manifest, objectId, parentId);
      return this.#commitDocument(
        vaultId,
        head,
        document,
        latest.revision + 1,
        [latest.revisionId],
      );
    });
  }

  async #commitDocument(
    vaultId: string,
    currentHead: PrivateVaultLocalManifestHead | null,
    document: PrivateVaultContentDocument,
    revision: number,
    parents: readonly string[],
  ): Promise<PrivateVaultContentDocument> {
    const plaintext = encodePrivateVaultContentDocument(document);
    let documentRevisionId: string;
    try {
      ({ revisionId: documentRevisionId } = await this.#gateway.sealAndUpload({
        vaultId,
        objectId: document.id,
        revision,
        contentType: PRIVATE_VAULT_CONTENT_TYPE,
        plaintext,
        parentRevisionIds: parents,
      }));
    } finally {
      plaintext.fill(0);
    }

    const existingDocuments = currentHead?.manifest.documents ?? [];
    const existing = existingDocuments.find(
      (entry) => entry.objectId === document.id,
    );
    const manifest: PrivateVaultContentManifest = {
      version: 1,
      kind: "content-vault-manifest",
      vaultId,
      generation: (currentHead?.manifest.generation ?? 0) + 1,
      previousManifest: currentHead
        ? {
            objectId: currentHead.objectId,
            revisionId: currentHead.revisionId,
          }
        : null,
      documents: [
        ...existingDocuments.filter((entry) => entry.objectId !== document.id),
        {
          objectId: document.id,
          revisions: [
            ...(existing?.revisions ?? []),
            {
              revision,
              revisionId: documentRevisionId,
              parentRevisionIds: [...parents],
            },
          ],
        },
      ],
      committedAt: this.#now(),
    };
    const manifestObjectId = this.#objectId();
    const manifestPlaintext = encodePrivateVaultContentManifest(manifest);
    let manifestRevisionId: string;
    try {
      ({ revisionId: manifestRevisionId } = await this.#gateway.sealAndUpload({
        vaultId,
        objectId: manifestObjectId,
        revision: 1,
        contentType: PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
        plaintext: manifestPlaintext,
        parentRevisionIds: [],
      }));
    } finally {
      manifestPlaintext.fill(0);
    }

    await this.#index.writeDocument(vaultId, documentRevisionId, document);
    await this.#index.writeManifest({
      version: 1,
      objectId: manifestObjectId,
      revisionId: manifestRevisionId,
      manifest,
    });
    return Object.freeze({ ...document });
  }

  async #requireHead(vaultId: string) {
    const head = await this.#index.readManifest(vaultId);
    if (!head) throw new PrivateVaultContentMutationError();
    return head;
  }

  async #nextPosition(
    vaultId: string,
    head: PrivateVaultLocalManifestHead | null,
    parentId: string | null | undefined,
  ): Promise<number> {
    if (!head) return 0;
    const positions = await Promise.all(
      head.manifest.documents.map(async (entry) => {
        const latest = entry.revisions.at(-1)!;
        return this.#index.readDocument(
          vaultId,
          entry.objectId,
          latest.revisionId,
        );
      }),
    );
    if (positions.some((document) => !document))
      throw new PrivateVaultContentMutationError();
    return (
      Math.max(
        -1,
        ...positions
          .filter((document) => document!.parentId === (parentId ?? null))
          .map((document) => document!.position),
      ) + 1
    );
  }

  async #assertAcyclicMove(
    vaultId: string,
    manifest: PrivateVaultContentManifest,
    objectId: string,
    parentId: string | null,
  ): Promise<void> {
    if (parentId === objectId) throw new PrivateVaultContentMutationError();
    const byId = new Map(
      manifest.documents.map((entry) => [entry.objectId, entry] as const),
    );
    const visited = new Set<string>([objectId]);
    let candidate = parentId;
    while (candidate !== null) {
      if (visited.has(candidate)) throw new PrivateVaultContentMutationError();
      visited.add(candidate);
      const entry = byId.get(candidate);
      const latest = entry?.revisions.at(-1);
      if (!entry || !latest) throw new PrivateVaultContentMutationError();
      const document = await this.#index.readDocument(
        vaultId,
        candidate,
        latest.revisionId,
      );
      if (!document) throw new PrivateVaultContentMutationError();
      candidate = document.parentId;
    }
  }

  #serialize<T>(vaultId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(vaultId) ?? Promise.resolve();
    const result = previous.then(run, run);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(vaultId, tail);
    void tail.finally(() => {
      if (this.#tails.get(vaultId) === tail) this.#tails.delete(vaultId);
    });
    return result;
  }
}
