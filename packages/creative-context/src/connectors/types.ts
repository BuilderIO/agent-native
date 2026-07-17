import type {
  PrivateBlobHandle,
  PrivateBlobPutInput,
  PrivateBlobReadResult,
} from "@agent-native/core/private-blob";
import type { ProviderApiRuntime } from "@agent-native/core/provider-api";

import type { NormalizedContextItem, UpstreamAccess } from "../types.js";
import type { RenderedPageProvider } from "./rendered-page.js";

export type ContextConnectorKind =
  | "manual"
  | "upload"
  | "google-slides"
  | "figma"
  | "notion"
  | "website";

export interface ContextConnectorInventoryItem {
  externalId: string;
  kind: string;
  title: string;
  canonicalUrl?: string;
  mimeType?: string;
  sourceModifiedAt?: string;
  sizeBytes?: number;
  upstreamAccess?: UpstreamAccess;
  metadata?: Record<string, unknown>;
}

export interface ContextConnectorInventoryRequest {
  sourceId: string;
  config: Record<string, unknown>;
  cursor?: string | null;
  syncCursor?: string | null;
  limit?: number;
}

export interface ContextConnectorInventoryPage {
  items: ContextConnectorInventoryItem[];
  nextCursor: string | null;
  complete: boolean;
  syncCursor?: string | null;
  coverage: {
    inspected: number;
    returned: number;
    truncated: boolean;
  };
}

export interface ContextConnectorFetchRequest {
  sourceId: string;
  config: Record<string, unknown>;
  item: ContextConnectorInventoryItem;
}

export interface ContextConnectorFetchResult {
  items: NormalizedContextItem[];
  warnings?: string[];
}

export interface ContextUploadContent {
  text: string;
  mimeType?: string;
  title?: string;
  canonicalUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface ContextConnectorExecutionContext {
  appId: string;
  ownerEmail?: string;
  providerApi?: Pick<ProviderApiRuntime, "executeRequest">;
  renderedPages?: RenderedPageProvider;
  signal?: AbortSignal;
  now?: () => Date;
  resolveConnection?: (
    provider: string,
    requestedConnectionId?: string,
  ) => Promise<string | undefined>;
  loadUpload?: (
    item: ContextConnectorInventoryItem,
    config: Record<string, unknown>,
  ) => Promise<ContextUploadContent>;
  putPrivateBlob?: (
    input: PrivateBlobPutInput,
  ) => Promise<PrivateBlobHandle | null>;
  readPrivateBlob?: (
    handle: PrivateBlobHandle,
  ) => Promise<PrivateBlobReadResult>;
}

export interface ContextImportConnector {
  readonly kind: ContextConnectorKind;
  readonly label: string;
  readonly supportsIncremental: boolean;
  inventory(
    request: ContextConnectorInventoryRequest,
    context: ContextConnectorExecutionContext,
  ): Promise<ContextConnectorInventoryPage>;
  fetch(
    request: ContextConnectorFetchRequest,
    context: ContextConnectorExecutionContext,
  ): Promise<ContextConnectorFetchResult>;
  verifiesContainerOwner?(input: {
    config: Record<string, unknown>;
    inventory: ContextConnectorInventoryItem[];
  }): boolean;
}

export interface ContextImportConnectorSummary {
  kind: ContextConnectorKind;
  label: string;
  supportsIncremental: boolean;
}
