export interface Document {
  id: string;
  parentId: string | null;
  title: string;
  content: string;
  icon: string | null;
  position: number;
  isFavorite: boolean;
  visibility?: "private" | "org" | "public";
  createdAt: string;
  updatedAt: string;
}

export type SyncState = "idle" | "linked" | "syncing" | "error" | "conflict";

export interface DocumentSyncStatus {
  provider: "notion";
  connected: boolean;
  documentId: string;
  pageId: string | null;
  pageUrl: string | null;
  state: SyncState;
  lastSyncedAt: string | null;
  lastKnownRemoteUpdatedAt: string | null;
  lastPushedLocalUpdatedAt: string | null;
  hasConflict: boolean;
  remoteChanged: boolean;
  localChanged: boolean;
  lastError: string | null;
  warnings: string[];
}

export interface NotionConnectionStatus {
  connected: boolean;
  workspaceName: string | null;
  workspaceId: string | null;
  authUrl: string | null;
  error?: "missing_credentials";
  mode?: "api_key" | "oauth" | null;
}

export interface LinkNotionPageRequest {
  pageIdOrUrl: string;
}

export interface ResolveDocumentSyncConflictRequest {
  direction: "pull" | "push";
}

export interface DocumentCreateRequest {
  id?: string;
  title?: string;
  parentId?: string | null;
  content?: string;
  icon?: string;
}

export interface DocumentUpdateRequest {
  title?: string;
  content?: string;
  icon?: string | null;
  isFavorite?: boolean;
}

export interface DocumentMoveRequest {
  parentId?: string | null;
  position?: number;
}

export interface DocumentListResponse {
  documents: Document[];
}

export interface DocumentTreeNode extends Document {
  children: DocumentTreeNode[];
}

export interface NotionSearchResult {
  id: string;
  title: string;
  icon: string | null;
  url: string;
  lastEditedTime: string | null;
}

export interface NotionSearchResponse {
  results: NotionSearchResult[];
  hasMore: boolean;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface DocumentVersionListResponse {
  versions: DocumentVersion[];
}
