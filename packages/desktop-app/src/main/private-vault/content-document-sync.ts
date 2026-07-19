import {
  decodePrivateVaultContentDocument,
  decodePrivateVaultContentManifest,
  PRIVATE_VAULT_CONTENT_TYPE,
  PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
  type PrivateVaultLocalManifestHead,
} from "./content-document-codec.js";
import type { EncryptedContentIndexStore } from "./encrypted-content-index-store.js";

const MAXIMUM_MANIFEST_CANDIDATES = 2_048;

export class PrivateVaultContentSyncError extends Error {
  constructor() {
    super("Private Content synchronization unavailable");
    this.name = "PrivateVaultContentSyncError";
  }
}

interface HostedObjectEntry {
  readonly objectId: string;
  readonly objectType: "document" | "vault-manifest";
  readonly latestRevision: {
    readonly revision: number;
    readonly revisionId: string;
  };
}

export interface PrivateVaultContentSyncGateway {
  list(vaultId: string): Promise<readonly HostedObjectEntry[]>;
  open(input: {
    readonly vaultId: string;
    readonly objectId: string;
    readonly revisionId: string;
  }): Promise<{
    readonly plaintext: Uint8Array;
    readonly contentType:
      | typeof PRIVATE_VAULT_CONTENT_TYPE
      | typeof PRIVATE_VAULT_MANIFEST_CONTENT_TYPE;
  }>;
}

type ContentIndexSyncSurface = Pick<
  EncryptedContentIndexStore,
  "readManifest" | "writeDocument" | "writeManifest"
>;

function coordinate(
  head: Pick<PrivateVaultLocalManifestHead, "objectId" | "revisionId">,
) {
  return `${head.objectId}:${head.revisionId}`;
}

export class PrivateVaultContentSync {
  readonly #gateway: PrivateVaultContentSyncGateway;
  readonly #index: ContentIndexSyncSurface;

  constructor(input: {
    gateway: PrivateVaultContentSyncGateway;
    index: ContentIndexSyncSurface;
  }) {
    this.#gateway = input.gateway;
    this.#index = input.index;
  }

  async synchronize(
    vaultId: string,
    options?: {
      readonly documentIds?: ReadonlySet<string>;
      readonly includeHistory?: boolean;
    },
  ): Promise<PrivateVaultLocalManifestHead | null> {
    const objects = await this.#gateway.list(vaultId);
    const manifestObjects = objects.filter(
      (object) => object.objectType === "vault-manifest",
    );
    if (manifestObjects.length === 0) {
      if (await this.#index.readManifest(vaultId))
        throw new PrivateVaultContentSyncError();
      return null;
    }
    if (manifestObjects.length > MAXIMUM_MANIFEST_CANDIDATES)
      throw new PrivateVaultContentSyncError();

    const candidates = new Map<string, PrivateVaultLocalManifestHead>();
    for (const object of manifestObjects) {
      if (object.latestRevision.revision !== 1)
        throw new PrivateVaultContentSyncError();
      const opened = await this.#gateway.open({
        vaultId,
        objectId: object.objectId,
        revisionId: object.latestRevision.revisionId,
      });
      try {
        if (opened.contentType !== PRIVATE_VAULT_MANIFEST_CONTENT_TYPE)
          throw new PrivateVaultContentSyncError();
        const manifest = decodePrivateVaultContentManifest(opened.plaintext);
        if (manifest.vaultId !== vaultId)
          throw new PrivateVaultContentSyncError();
        const head = {
          version: 1 as const,
          objectId: object.objectId,
          revisionId: object.latestRevision.revisionId,
          manifest,
        };
        candidates.set(coordinate(head), head);
      } finally {
        opened.plaintext.fill(0);
      }
    }

    const highestGeneration = Math.max(
      ...[...candidates.values()].map((head) => head.manifest.generation),
    );
    const highest = [...candidates.values()].filter(
      (head) => head.manifest.generation === highestGeneration,
    );
    if (highest.length !== 1) throw new PrivateVaultContentSyncError();
    const selected = highest[0];
    const selectedChain = this.#verifiedChain(selected, candidates);

    const local = await this.#index.readManifest(vaultId);
    if (local) {
      if (local.manifest.generation > selected.manifest.generation)
        throw new PrivateVaultContentSyncError();
      const chainHead = selectedChain.get(coordinate(local));
      if (
        !chainHead ||
        chainHead.manifest.generation !== local.manifest.generation
      )
        throw new PrivateVaultContentSyncError();
    }

    for (const entry of selected.manifest.documents) {
      if (options?.documentIds && !options.documentIds.has(entry.objectId))
        continue;
      const revisions = options?.includeHistory
        ? entry.revisions
        : entry.revisions.slice(-1);
      if (revisions.length === 0) throw new PrivateVaultContentSyncError();
      for (const revision of revisions) {
        const opened = await this.#gateway.open({
          vaultId,
          objectId: entry.objectId,
          revisionId: revision.revisionId,
        });
        try {
          if (opened.contentType !== PRIVATE_VAULT_CONTENT_TYPE)
            throw new PrivateVaultContentSyncError();
          const document = decodePrivateVaultContentDocument(opened.plaintext);
          if (
            document.id !== entry.objectId ||
            (entry.parentId !== undefined &&
              document.parentId !== entry.parentId) ||
            (entry.position !== undefined &&
              document.position !== entry.position)
          )
            throw new PrivateVaultContentSyncError();
          await this.#index.writeDocument(
            vaultId,
            revision.revisionId,
            document,
          );
        } finally {
          opened.plaintext.fill(0);
        }
      }
    }
    await this.#index.writeManifest(selected);
    return selected;
  }

  #verifiedChain(
    selected: PrivateVaultLocalManifestHead,
    candidates: ReadonlyMap<string, PrivateVaultLocalManifestHead>,
  ): Map<string, PrivateVaultLocalManifestHead> {
    const chain = new Map<string, PrivateVaultLocalManifestHead>();
    let current = selected;
    while (true) {
      const key = coordinate(current);
      if (chain.has(key)) throw new PrivateVaultContentSyncError();
      chain.set(key, current);
      const previous = current.manifest.previousManifest;
      if (current.manifest.generation === 1) {
        if (previous !== null) throw new PrivateVaultContentSyncError();
        return chain;
      }
      if (!previous) throw new PrivateVaultContentSyncError();
      const parent = candidates.get(coordinate(previous));
      if (
        !parent ||
        parent.manifest.generation !== current.manifest.generation - 1
      )
        throw new PrivateVaultContentSyncError();
      current = parent;
    }
  }
}
