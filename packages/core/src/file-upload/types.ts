
export interface FileUploadInput {
  data: Uint8Array | Buffer;
  filename?: string;
  mimeType?: string;
  ownerEmail?: string;
  stableUrl?: boolean;
  recordAsset?: boolean;
}

export interface FileUploadResult {
  url: string;
  id?: string;
  provider: string;
}

export interface FileUploadDeleteInput {
  url: string;
  id?: string;
}

export interface ResumableUploadSession {
  sessionId: string;
  meta: Record<string, unknown>;
}

export interface ResumableChunkResult {
  ok: boolean;
  status: number;
  updatedMeta?: Record<string, unknown>;
}

export interface FileUploadProvider {
  id: string;
  name: string;
  isConfigured: () => boolean;
  isConfiguredForRequest?: () => Promise<boolean>;
  isOwnedUrl?: (url: string) => boolean | Promise<boolean>;
  upload: (input: FileUploadInput) => Promise<FileUploadResult>;
  delete?: (input: FileUploadDeleteInput) => Promise<boolean>;
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
      options?: { stableUrl?: boolean; recordAsset?: boolean },
    ): Promise<string>;
    abortSession?(session: ResumableUploadSession): Promise<void>;
  };
}
