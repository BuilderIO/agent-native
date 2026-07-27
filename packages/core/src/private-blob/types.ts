export interface PrivateBlobMetadata {
  [key: string]: string | number | boolean | null | undefined;
}

export interface PrivateBlobPutInput {
  /** Private blob contents. */
  data: Uint8Array | Buffer;
  /** Optional caller-owned key for providers that support deterministic paths. */
  key?: string;
  /** Original filename or logical blob name. */
  filename?: string;
  /** MIME type, e.g. "application/json". */
  mimeType?: string;
  /** Optional owner email for provider-specific scoping. */
  ownerEmail?: string;
  /** Low-cardinality metadata safe to store beside the blob. */
  metadata?: PrivateBlobMetadata;
}

export interface PrivateBlobHandle {
  /** Opaque provider handle. Consumers must not interpret this as a URL. */
  id: string;
  /** Provider that owns the handle. */
  provider: string;
  /** True for handles that intentionally do not expose fetchable URLs. */
  opaque: true;
  /** True when bytes are encrypted before reaching the backing store. */
  encrypted: boolean;
  mimeType?: string;
  size?: number;
  createdAt?: string;
  metadata?: PrivateBlobMetadata;
}

export interface PrivateBlobReadResult {
  data: Uint8Array;
  mimeType?: string;
  metadata?: PrivateBlobMetadata;
  handle: PrivateBlobHandle;
}

export interface PrivateBlobDeleteResult {
  deleted: boolean;
  provider: string;
  reason?: string;
}

export interface PrivateBlobProvider {
  id: string;
  name: string;
  isConfigured: () => boolean;
  put: (input: PrivateBlobPutInput) => Promise<PrivateBlobHandle>;
  read: (handle: PrivateBlobHandle) => Promise<PrivateBlobReadResult>;
  delete: (handle: PrivateBlobHandle) => Promise<PrivateBlobDeleteResult>;
}
