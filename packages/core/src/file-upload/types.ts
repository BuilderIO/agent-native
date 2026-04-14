/**
 * File upload framework primitive.
 *
 * Templates call `uploadFile()` to upload a file and get back a URL.
 * The framework dispatches to whichever provider is registered (Builder.io
 * built-in, or a user-supplied one). If no provider is active, it falls back
 * to the SQL resources store — fine for dev, not recommended for production.
 */

export interface FileUploadInput {
  /** File contents. */
  data: Uint8Array | Buffer;
  /** Original filename, used for extension/display. */
  filename?: string;
  /** MIME type, e.g. "image/png". */
  mimeType?: string;
  /** Optional owner email for per-user scoping in fallback storage. */
  ownerEmail?: string;
}

export interface FileUploadResult {
  /** Public URL where the file can be fetched. */
  url: string;
  /** Optional provider-specific id (e.g. resource id, Builder asset id). */
  id?: string;
  /** The provider that handled the upload. */
  provider: string;
}

export interface FileUploadProvider {
  /** Unique id, e.g. "builder", "s3". */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Returns true if this provider is currently configured (env vars etc.). */
  isConfigured: () => boolean;
  /** Upload a file and return a URL. Throw on failure. */
  upload: (input: FileUploadInput) => Promise<FileUploadResult>;
}
