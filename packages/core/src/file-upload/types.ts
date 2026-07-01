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
  /** Builder.io upload hint: return after asset registration instead of waiting for server-side compression. */
  skipCompressionWait?: boolean;
}

export interface FileUploadResult {
  /** Public URL where the file can be fetched. */
  url: string;
  /** Optional provider-specific id (e.g. resource id, Builder asset id). */
  id?: string;
  /** The provider that handled the upload. */
  provider: string;
}

/** Opaque session handle returned by {@link FileUploadProvider.resumable.startSession}.
 * `sessionId` is provider-specific (GCS Location URI, S3 UploadId, etc.).
 * `meta` holds any provider state needed for subsequent relay and complete calls. */
export interface ResumableUploadSession {
  sessionId: string;
  meta: Record<string, unknown>;
}

export interface ResumableChunkResult {
  ok: boolean;
  status: number;
  /** Providers that need per-chunk state (e.g. S3 ETags) return updated meta
   * here; the chunk route merges it back into the stored session. */
  updatedMeta?: Record<string, unknown>;
}

export interface FileUploadProvider {
  /** Unique id, e.g. "builder", "s3". */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Returns true if this provider is configured from synchronous runtime state. */
  isConfigured: () => boolean;
  /**
   * Returns true if this provider is configured for the active request.
   * Use for DB-backed user/org/workspace secrets that require request context.
   */
  isConfiguredForRequest?: () => Promise<boolean>;
  /** Upload a file and return a URL. Throw on failure. */
  upload: (input: FileUploadInput) => Promise<FileUploadResult>;
  /**
   * Optional resumable/streaming upload capability.
   * When present, create-recording will initialise a session and stream chunks
   * during recording instead of assembling the full blob after stop().
   */
  resumable?: {
    startSession(
      filename: string,
      mimeType: string,
      maxBytes: number,
    ): Promise<ResumableUploadSession>;
    relayChunk(
      session: ResumableUploadSession,
      contentRange: string,
      bytes: Uint8Array,
      options?: { mimeType?: string },
    ): Promise<ResumableChunkResult>;
    completeSession(
      session: ResumableUploadSession,
      filename: string,
      options?: { skipCompressionWait?: boolean },
    ): Promise<string>;
  };
}
