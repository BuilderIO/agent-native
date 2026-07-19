import type {
  PrivateVaultContentDocument,
  PrivateVaultContentManifest,
} from "./content-document-codec.js";
import type { EncryptedContentIndexStore } from "./encrypted-content-index-store.js";

export class PrivateVaultContentRegistryError extends Error {
  constructor(message = "Private Content is locked or unavailable") {
    super(message);
    this.name = "PrivateVaultContentRegistryError";
  }
}

export interface PrivateVaultDocumentSummary {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly contentPreview: string;
  readonly contentLength: number;
  readonly icon: string | null;
  readonly position: number;
  readonly isFavorite: boolean;
  readonly hideFromSearch: boolean;
  readonly visibility: "private-vault";
  readonly accessRole: "owner";
  readonly canEdit: true;
  readonly canManage: true;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function preview(content: string, maximum = 180): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length <= maximum
    ? compact
    : `${compact.slice(0, maximum).trimEnd()}...`;
}

function snippet(content: string, query: string, radius = 120): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const index = compact.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return preview(compact, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(compact.length, index + query.length + radius);
  return `${start > 0 ? "..." : ""}${compact.slice(start, end).trim()}${
    end < compact.length ? "..." : ""
  }`;
}

function summary(document: PrivateVaultContentDocument) {
  return Object.freeze<PrivateVaultDocumentSummary>({
    id: document.id,
    parentId: document.parentId,
    title: document.title,
    description: document.description,
    contentPreview: preview(document.content),
    contentLength: document.content.length,
    icon: document.icon,
    position: document.position,
    isFavorite: document.isFavorite,
    hideFromSearch: document.hideFromSearch,
    visibility: "private-vault",
    accessRole: "owner",
    canEdit: true,
    canManage: true,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  });
}

function validateTree(
  documents: ReadonlyMap<string, PrivateVaultContentDocument>,
) {
  for (const document of documents.values()) {
    if (document.parentId !== null && !documents.has(document.parentId))
      throw new PrivateVaultContentRegistryError();
    const visited = new Set<string>([document.id]);
    let parentId = document.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) throw new PrivateVaultContentRegistryError();
      visited.add(parentId);
      parentId = documents.get(parentId)?.parentId ?? null;
    }
  }
}

export class PrivateVaultContentRegistry {
  readonly #index: Pick<
    EncryptedContentIndexStore,
    "readManifest" | "readDocument"
  >;

  constructor(
    index: Pick<EncryptedContentIndexStore, "readManifest" | "readDocument">,
  ) {
    this.#index = index;
  }

  async listDocuments(vaultId: string): Promise<{
    readonly manifest: PrivateVaultContentManifest;
    readonly documents: readonly PrivateVaultDocumentSummary[];
  }> {
    const { manifest, documents } = await this.#load(vaultId);
    return Object.freeze({
      manifest,
      documents: Object.freeze(
        [...documents.values()]
          .sort(
            (left, right) =>
              left.position - right.position || left.id.localeCompare(right.id),
          )
          .map(summary),
      ),
    });
  }

  async getDocument(
    vaultId: string,
    objectId: string,
  ): Promise<
    PrivateVaultContentDocument & {
      readonly visibility: "private-vault";
      readonly accessRole: "owner";
      readonly canEdit: true;
      readonly canManage: true;
    }
  > {
    const { documents } = await this.#load(vaultId);
    const document = documents.get(objectId);
    if (!document) throw new PrivateVaultContentRegistryError();
    return Object.freeze({
      ...document,
      visibility: "private-vault",
      accessRole: "owner",
      canEdit: true,
      canManage: true,
    });
  }

  async searchDocuments(
    vaultId: string,
    queryInput: string,
    limit = 50,
  ): Promise<{
    readonly documents: readonly (Omit<
      PrivateVaultDocumentSummary,
      "contentPreview"
    > & { readonly snippet: string })[];
  }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw new PrivateVaultContentRegistryError();
    const query = queryInput.trim().toLocaleLowerCase();
    const { documents } = await this.#load(vaultId);
    const matches = [...documents.values()]
      .filter((document) => !document.hideFromSearch)
      .filter(
        (document) =>
          !query ||
          document.title.toLocaleLowerCase().includes(query) ||
          (document.description ?? "").toLocaleLowerCase().includes(query) ||
          document.content.toLocaleLowerCase().includes(query),
      )
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, limit)
      .map((document) => {
        const { contentPreview: _contentPreview, ...metadata } =
          summary(document);
        return Object.freeze({
          ...metadata,
          snippet: snippet(document.content, queryInput.trim()),
        });
      });
    return Object.freeze({ documents: Object.freeze(matches) });
  }

  async #load(vaultId: string): Promise<{
    manifest: PrivateVaultContentManifest;
    documents: Map<string, PrivateVaultContentDocument>;
  }> {
    const manifest = await this.#index.readManifest(vaultId);
    if (!manifest || manifest.vaultId !== vaultId)
      throw new PrivateVaultContentRegistryError();
    const loaded = await Promise.all(
      manifest.documents.map(async (entry) => ({
        entry,
        document: await this.#index.readDocument(vaultId, entry.objectId),
      })),
    );
    const documents = new Map<string, PrivateVaultContentDocument>();
    for (const { entry, document } of loaded) {
      if (!document || document.id !== entry.objectId)
        throw new PrivateVaultContentRegistryError();
      documents.set(entry.objectId, document);
    }
    validateTree(documents);
    return { manifest, documents };
  }
}
