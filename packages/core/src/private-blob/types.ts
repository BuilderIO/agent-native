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

export interface PrivateBlobProvider {
  id: string;
  name: string;
  isConfigured: () => boolean;
  isConfiguredForRequest?: () => Promise<boolean>;
  put: (input: PrivateBlobPutInput) => Promise<PrivateBlobHandle>;
  read: (handle: PrivateBlobHandle) => Promise<PrivateBlobReadResult>;
  delete: (handle: PrivateBlobHandle) => Promise<PrivateBlobDeleteResult>;
}
