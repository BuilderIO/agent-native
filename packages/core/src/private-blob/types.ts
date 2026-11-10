export interface PrivateBlobMetadata {
  [key: string]: string | number | boolean | null | undefined;
}

export interface PrivateBlobPutInput {
  data: Uint8Array | Buffer;
  key?: string;
  filename?: string;
  mimeType?: string;
  ownerEmail?: string;
  metadata?: PrivateBlobMetadata;
}

export interface PrivateBlobHandle {
  id: string;
  provider: string;
  opaque: true;
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

/** What a provider sees when deciding whether it stores a put. */
export type PrivateBlobPutRequest = Pick<
  PrivateBlobPutInput,
  "mimeType" | "metadata"
>;

/** An HTTP-style byte range. `end` is inclusive; omit it to read to the end. */
export interface PrivateBlobByteRange {
  start: number;
  end?: number;
}

export interface PrivateBlobRangeReadResult extends PrivateBlobReadResult {
  /** The bytes actually returned (inclusive), and the blob's full size. */
  range: { start: number; end: number; size: number };
}

export interface PrivateBlobReadUrlOptions {
  expiresInSeconds: number;
  /** Content-Type the storage should send with the bytes. */
  contentType?: string;
  /** Content-Disposition the storage should send with the bytes. */
  contentDisposition?: string;
}

export interface PrivateBlobReadUrl {
  url: string;
  expiresAt: string;
}

export interface PrivateBlobProvider {
  id: string;
  name: string;
  isConfigured: () => boolean;
  isConfiguredForRequest?: () => Promise<boolean>;
  /**
   * Limits this provider to the puts it accepts (for example one `purpose`).
   * A provider with `handles` is only chosen for puts it claims, never as the
   * default for every private blob.
   */
  handles?: (request: PrivateBlobPutRequest) => boolean;
  put: (input: PrivateBlobPutInput) => Promise<PrivateBlobHandle>;
  read: (handle: PrivateBlobHandle) => Promise<PrivateBlobReadResult>;
  /**
   * Reads part of a blob for media seeking, without loading the rest when
   * storage allows. Encrypted blobs decrypt only whole, so a range read loads
   * and decrypts the whole blob, then returns the slice.
   */
  readRange?: (
    handle: PrivateBlobHandle,
    range: PrivateBlobByteRange,
  ) => Promise<PrivateBlobRangeReadResult>;
  /**
   * Returns a link that reads the blob straight from storage until it
   * expires, so bytes skip the app server. Return null when this blob can't
   * be served that way (for example, encrypted bytes).
   */
  getReadUrl?: (
    handle: PrivateBlobHandle,
    options: PrivateBlobReadUrlOptions,
  ) => Promise<PrivateBlobReadUrl | null>;
  delete: (handle: PrivateBlobHandle) => Promise<PrivateBlobDeleteResult>;
}
