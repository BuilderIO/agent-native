import {
  decodePrivateVaultContentDocument,
  decodePrivateVaultContentManifest,
  encodePrivateVaultContentDocument,
  encodePrivateVaultContentManifest,
  PRIVATE_VAULT_CONTENT_TYPE,
  PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
  privateVaultContentDocumentSchema,
  privateVaultContentManifestSchema,
  type PrivateVaultContentDocument,
  type PrivateVaultContentManifest,
  type PrivateVaultLocalManifestHead,
} from "./content-document-codec.js";

type MigrationState =
  | "preflight"
  | "copying"
  | "verifying"
  | "ready_for_cutover"
  | "cutover"
  | "cleanup_eligible"
  | "cleaned"
  | "rolled_back"
  | "failed";

export interface PrivateVaultMigrationLedgerProjection {
  readonly migrationId: string;
  readonly vaultId: string;
  readonly state: MigrationState;
  readonly sourceSnapshotHash: string;
  readonly sourceCount: number;
  readonly verifiedCount: number;
  readonly cutoverManifestObjectId: string | null;
  readonly cutoverManifestRevisionId: string | null;
  readonly cutoverManifestCiphertextHash: string | null;
}

export interface PrivateVaultMigrationItemProjection {
  readonly migrationId: string;
  readonly sourceDocumentId: string;
  readonly parentSourceDocumentId: string | null;
  readonly objectId: string;
  readonly sourceDigest: string;
  readonly state: "pending" | "sealed" | "verified" | "cleaned";
  readonly sealedRevisionId: string | null;
  readonly sealedCiphertextHash: string | null;
}

export interface PrivateVaultMigrationSourceProjection {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly content: string;
  readonly description: string;
  readonly icon: string | null;
  readonly position: number;
  readonly isFavorite: boolean;
  readonly hideFromSearch: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MigrationSnapshot {
  readonly ledger: PrivateVaultMigrationLedgerProjection;
  readonly items: readonly PrivateVaultMigrationItemProjection[];
}

export interface PrivateVaultMigrationHostedClient {
  active(vaultId: string): Promise<MigrationSnapshot | null>;
  candidates(vaultId: string): Promise<readonly string[]>;
  preflight(
    vaultId: string,
    sourceDocumentIds: readonly string[],
  ): Promise<PrivateVaultMigrationLedgerProjection>;
  status(vaultId: string, migrationId: string): Promise<MigrationSnapshot>;
  begin(
    vaultId: string,
    migrationId: string,
  ): Promise<PrivateVaultMigrationLedgerProjection>;
  readSource(
    vaultId: string,
    migrationId: string,
    sourceDocumentId: string,
  ): Promise<PrivateVaultMigrationSourceProjection>;
  verifyItem(input: {
    readonly vaultId: string;
    readonly migrationId: string;
    readonly sourceDocumentId: string;
    readonly revisionId: string;
    readonly ciphertextHash: string;
  }): Promise<PrivateVaultMigrationLedgerProjection>;
  cutover(input: {
    readonly vaultId: string;
    readonly migrationId: string;
    readonly objectId: string;
    readonly revisionId: string;
    readonly ciphertextHash: string;
  }): Promise<PrivateVaultMigrationLedgerProjection>;
  cleanup(
    vaultId: string,
    migrationId: string,
  ): Promise<PrivateVaultMigrationLedgerProjection>;
}

export interface PrivateVaultMigrationObjectGateway {
  sealAndUpload(input: {
    readonly vaultId: string;
    readonly objectId: string;
    readonly revision: number;
    readonly contentType:
      | typeof PRIVATE_VAULT_CONTENT_TYPE
      | typeof PRIVATE_VAULT_MANIFEST_CONTENT_TYPE;
    readonly plaintext: Uint8Array;
    readonly parentRevisionIds: readonly string[];
  }): Promise<{
    readonly revisionId: string;
    readonly ciphertextHash: string;
  }>;
  downloadAndOpen(input: {
    readonly vaultId: string;
    readonly objectId: string;
    readonly revisionId: string;
  }): Promise<{
    readonly plaintext: Uint8Array;
    readonly metadata: { readonly objectType: "document" | "vault-manifest" };
  }>;
}

export interface PrivateVaultMigrationLocalIndex {
  readManifest(vaultId: string): Promise<PrivateVaultLocalManifestHead | null>;
  readDocument(
    vaultId: string,
    objectId: string,
    revisionId: string,
  ): Promise<PrivateVaultContentDocument | null>;
  writeDocument(
    vaultId: string,
    revisionId: string,
    document: PrivateVaultContentDocument,
  ): Promise<void>;
  writeManifest(head: PrivateVaultLocalManifestHead): Promise<void>;
}

export class PrivateVaultContentMigrationError extends Error {
  constructor() {
    super("Private Content migration unavailable");
    this.name = "PrivateVaultContentMigrationError";
  }
}

function fail(): never {
  throw new PrivateVaultContentMigrationError();
}

/**
 * Copies legacy plaintext only inside signed Desktop. Individual document
 * ciphertext remains invisible until one verified encrypted manifest cuts over.
 */
export class PrivateVaultContentMigrationRuntime {
  readonly #hosted: PrivateVaultMigrationHostedClient;
  readonly #objects: PrivateVaultMigrationObjectGateway;
  readonly #index: PrivateVaultMigrationLocalIndex;
  readonly #now: () => string;
  readonly #tails = new Map<string, Promise<void>>();

  constructor(input: {
    hosted: PrivateVaultMigrationHostedClient;
    objects: PrivateVaultMigrationObjectGateway;
    index: PrivateVaultMigrationLocalIndex;
    now?: () => string;
  }) {
    this.#hosted = input.hosted;
    this.#objects = input.objects;
    this.#index = input.index;
    this.#now = input.now ?? (() => new Date().toISOString());
  }

  async listCandidates(vaultId: string): Promise<readonly string[]> {
    const ids = await this.#hosted.candidates(vaultId);
    if (
      ids.length > 10_000 ||
      new Set(ids).size !== ids.length ||
      ids.some(
        (id) => typeof id !== "string" || id.length === 0 || id.length > 256,
      )
    )
      fail();
    return Object.freeze([...ids]);
  }

  active(vaultId: string): Promise<MigrationSnapshot | null> {
    return this.#hosted.active(vaultId);
  }

  cleanup(
    vaultId: string,
    migrationId: string,
  ): Promise<PrivateVaultMigrationLedgerProjection> {
    return this.#serialize(vaultId, async () => {
      const snapshot = await this.#hosted.status(vaultId, migrationId);
      this.#validateSnapshot(vaultId, snapshot);
      if (snapshot.ledger.state === "cleaned") return snapshot.ledger;
      if (snapshot.ledger.state !== "cleanup_eligible") fail();
      // Re-open the committed manifest and every encrypted document immediately
      // before asking hosted Content to remove the Standard Cloud originals.
      await this.#installCutover(vaultId, migrationId);
      const cleaned = await this.#hosted.cleanup(vaultId, migrationId);
      if (cleaned.state !== "cleaned") fail();
      return cleaned;
    });
  }

  migrate(input: {
    readonly vaultId: string;
    readonly sourceDocumentIds?: readonly string[];
    readonly migrationId?: string;
  }): Promise<PrivateVaultMigrationLedgerProjection> {
    return this.#serialize(input.vaultId, async () => {
      if (!!input.migrationId === !!input.sourceDocumentIds) fail();
      const active = input.migrationId
        ? null
        : await this.#hosted.active(input.vaultId);
      let ledger = input.migrationId
        ? (await this.#hosted.status(input.vaultId, input.migrationId)).ledger
        : active
          ? active.ledger
          : await this.#hosted.preflight(
              input.vaultId,
              input.sourceDocumentIds!,
            );
      if (ledger.vaultId !== input.vaultId) fail();
      if (ledger.state === "preflight")
        ledger = await this.#hosted.begin(input.vaultId, ledger.migrationId);
      if (ledger.state === "copying" || ledger.state === "verifying")
        ledger = await this.#copyAndVerify(input.vaultId, ledger.migrationId);
      if (ledger.state === "ready_for_cutover")
        ledger = await this.#publishManifest(input.vaultId, ledger.migrationId);
      if (
        ledger.state === "cutover" ||
        ledger.state === "cleanup_eligible" ||
        ledger.state === "cleaned"
      ) {
        await this.#installCutover(input.vaultId, ledger.migrationId);
        return ledger;
      }
      fail();
    });
  }

  async #copyAndVerify(vaultId: string, migrationId: string) {
    let snapshot = await this.#hosted.status(vaultId, migrationId);
    const itemBySource = this.#validateSnapshot(vaultId, snapshot);
    for (const item of snapshot.items) {
      if (item.state === "verified") continue;
      if (item.state !== "pending" && item.state !== "sealed") fail();
      const source = await this.#hosted.readSource(
        vaultId,
        migrationId,
        item.sourceDocumentId,
      );
      const document = this.#sourceDocument(source, itemBySource);
      if (document.id !== item.objectId) fail();
      const plaintext = encodePrivateVaultContentDocument(document);
      let sealed: { revisionId: string; ciphertextHash: string };
      try {
        sealed = await this.#objects.sealAndUpload({
          vaultId,
          objectId: item.objectId,
          revision: 1,
          contentType: PRIVATE_VAULT_CONTENT_TYPE,
          plaintext,
          parentRevisionIds: [],
        });
      } finally {
        plaintext.fill(0);
      }
      await this.#index.writeDocument(vaultId, sealed.revisionId, document);
      await this.#hosted.verifyItem({
        vaultId,
        migrationId,
        sourceDocumentId: item.sourceDocumentId,
        revisionId: sealed.revisionId,
        ciphertextHash: sealed.ciphertextHash,
      });
    }
    snapshot = await this.#hosted.status(vaultId, migrationId);
    this.#validateSnapshot(vaultId, snapshot);
    return snapshot.ledger;
  }

  async #publishManifest(vaultId: string, migrationId: string) {
    const snapshot = await this.#hosted.status(vaultId, migrationId);
    this.#validateSnapshot(vaultId, snapshot);
    if (
      snapshot.ledger.state !== "ready_for_cutover" ||
      !snapshot.ledger.cutoverManifestObjectId ||
      snapshot.items.some(
        (item) =>
          item.state !== "verified" ||
          !item.sealedRevisionId ||
          !item.sealedCiphertextHash,
      )
    )
      fail();
    const manifestObjectId = snapshot.ledger.cutoverManifestObjectId;
    const current = await this.#index.readManifest(vaultId);
    const existing = current
      ? await this.#structuredEntries(vaultId, current.manifest)
      : [];
    const migrated = await Promise.all(
      snapshot.items.map(async (item) => {
        const document = await this.#loadVerifiedDocument(vaultId, item);
        return {
          objectId: item.objectId,
          parentId: document.parentId,
          position: document.position,
          revisions: [
            {
              revision: 1,
              revisionId: item.sealedRevisionId,
              parentRevisionIds: [],
            },
          ],
        };
      }),
    );
    const migratedIds = new Set(migrated.map((entry) => entry.objectId));
    if (
      migratedIds.size !== migrated.length ||
      existing.some((entry) => migratedIds.has(entry.objectId))
    )
      fail();
    const manifest = privateVaultContentManifestSchema.parse({
      version: 1,
      kind: "content-vault-manifest",
      vaultId,
      generation: (current?.manifest.generation ?? 0) + 1,
      previousManifest: current
        ? { objectId: current.objectId, revisionId: current.revisionId }
        : null,
      documents: [...existing, ...migrated],
      committedAt: this.#now(),
    });
    const plaintext = encodePrivateVaultContentManifest(manifest);
    let sealed: { revisionId: string; ciphertextHash: string };
    try {
      sealed = await this.#objects.sealAndUpload({
        vaultId,
        objectId: manifestObjectId,
        revision: 1,
        contentType: PRIVATE_VAULT_MANIFEST_CONTENT_TYPE,
        plaintext,
        parentRevisionIds: [],
      });
    } finally {
      plaintext.fill(0);
    }
    return this.#hosted.cutover({
      vaultId,
      migrationId,
      objectId: manifestObjectId,
      revisionId: sealed.revisionId,
      ciphertextHash: sealed.ciphertextHash,
    });
  }

  async #loadVerifiedDocument(
    vaultId: string,
    item: PrivateVaultMigrationItemProjection,
  ): Promise<PrivateVaultContentDocument> {
    if (!item.sealedRevisionId) fail();
    const cached = await this.#index.readDocument(
      vaultId,
      item.objectId,
      item.sealedRevisionId,
    );
    if (cached) {
      if (cached.id !== item.objectId) fail();
      return cached;
    }
    const opened = await this.#objects.downloadAndOpen({
      vaultId,
      objectId: item.objectId,
      revisionId: item.sealedRevisionId,
    });
    try {
      if (opened.metadata.objectType !== "document") fail();
      const document = decodePrivateVaultContentDocument(opened.plaintext);
      if (document.id !== item.objectId) fail();
      await this.#index.writeDocument(vaultId, item.sealedRevisionId, document);
      return document;
    } finally {
      opened.plaintext.fill(0);
    }
  }

  async #installCutover(vaultId: string, migrationId: string): Promise<void> {
    const snapshot = await this.#hosted.status(vaultId, migrationId);
    this.#validateSnapshot(vaultId, snapshot);
    const { ledger } = snapshot;
    if (
      !ledger.cutoverManifestObjectId ||
      !ledger.cutoverManifestRevisionId ||
      !ledger.cutoverManifestCiphertextHash
    )
      fail();
    const manifestObjectId = ledger.cutoverManifestObjectId;
    const manifestRevisionId = ledger.cutoverManifestRevisionId;
    const openedManifest = await this.#objects.downloadAndOpen({
      vaultId,
      objectId: manifestObjectId,
      revisionId: manifestRevisionId,
    });
    let manifest: PrivateVaultContentManifest;
    try {
      if (openedManifest.metadata.objectType !== "vault-manifest") fail();
      manifest = decodePrivateVaultContentManifest(openedManifest.plaintext);
    } finally {
      openedManifest.plaintext.fill(0);
    }
    if (manifest.vaultId !== vaultId) fail();
    const migratedIds = new Set(snapshot.items.map((item) => item.objectId));
    if (
      snapshot.items.some(
        (item) =>
          !item.sealedRevisionId ||
          !manifest.documents.some(
            (entry) =>
              entry.objectId === item.objectId &&
              entry.revisions.some(
                (revision) => revision.revisionId === item.sealedRevisionId,
              ),
          ),
      ) ||
      migratedIds.size !== snapshot.items.length
    )
      fail();
    for (const item of snapshot.items) {
      const revisionId = item.sealedRevisionId!;
      const opened = await this.#objects.downloadAndOpen({
        vaultId,
        objectId: item.objectId,
        revisionId,
      });
      try {
        if (opened.metadata.objectType !== "document") fail();
        const document = decodePrivateVaultContentDocument(opened.plaintext);
        if (document.id !== item.objectId) fail();
        await this.#index.writeDocument(vaultId, revisionId, document);
      } finally {
        opened.plaintext.fill(0);
      }
    }
    await this.#index.writeManifest({
      version: 1,
      objectId: manifestObjectId,
      revisionId: manifestRevisionId,
      manifest,
    });
  }

  #validateSnapshot(
    vaultId: string,
    snapshot: MigrationSnapshot,
  ): Map<string, PrivateVaultMigrationItemProjection> {
    if (
      snapshot.ledger.vaultId !== vaultId ||
      snapshot.items.length !== snapshot.ledger.sourceCount ||
      new Set(snapshot.items.map((item) => item.sourceDocumentId)).size !==
        snapshot.items.length ||
      new Set(snapshot.items.map((item) => item.objectId)).size !==
        snapshot.items.length
    )
      fail();
    const result = new Map(
      snapshot.items.map((item) => [item.sourceDocumentId, item] as const),
    );
    for (const item of snapshot.items)
      if (
        item.parentSourceDocumentId &&
        !result.has(item.parentSourceDocumentId)
      )
        fail();
    return result;
  }

  #sourceDocument(
    source: PrivateVaultMigrationSourceProjection,
    itemBySource: ReadonlyMap<string, PrivateVaultMigrationItemProjection>,
  ): PrivateVaultContentDocument {
    const item = itemBySource.get(source.id);
    if (!item || source.parentId !== item.parentSourceDocumentId) fail();
    const parentId = source.parentId
      ? itemBySource.get(source.parentId)?.objectId
      : null;
    if (source.parentId && !parentId) fail();
    return privateVaultContentDocumentSchema.parse({
      version: 1,
      kind: "content-document",
      id: item.objectId,
      parentId,
      title: source.title,
      content: source.content,
      description: source.description,
      icon: source.icon,
      position: source.position,
      isFavorite: source.isFavorite,
      hideFromSearch: source.hideFromSearch,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    });
  }

  async #structuredEntries(
    vaultId: string,
    manifest: PrivateVaultContentManifest,
  ) {
    return Promise.all(
      manifest.documents.map(async (entry) => {
        if (entry.parentId !== undefined && entry.position !== undefined)
          return entry;
        const latest = entry.revisions.at(-1);
        if (!latest) fail();
        const document = await this.#index.readDocument(
          vaultId,
          entry.objectId,
          latest.revisionId,
        );
        if (!document) fail();
        return {
          ...entry,
          parentId: document.parentId,
          position: document.position,
        };
      }),
    );
  }

  #serialize<T>(vaultId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(vaultId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(vaultId, tail);
    return current.finally(() => {
      if (this.#tails.get(vaultId) === tail) this.#tails.delete(vaultId);
    });
  }
}
