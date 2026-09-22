import type { ContentDatabaseMutationTarget } from "./api.js";
import type {
  BlocksFieldBlockKind,
  BlocksFieldBlockOperation,
  BlocksFieldIdentityStatus,
} from "./blocks-field-identity.js";

export interface ContentDatabaseBlockTarget extends ContentDatabaseMutationTarget {
  itemId: string;
  rowDocumentId: string;
  propertyId: string;
}

export interface ContentDatabaseBlockValue {
  format: "nfm";
  nfm: string;
}

export interface ContentDatabaseBlock {
  id: string;
  parentId: string | null;
  kind: BlocksFieldBlockKind;
  index: number;
  addressable: boolean;
  value: ContentDatabaseBlockValue;
  supportedOperations: readonly BlocksFieldBlockOperation[];
  degraded: boolean;
}

export interface ContentDatabaseBlocksReadResult {
  target: ContentDatabaseBlockTarget;
  rowLink: { urlPath: string; label: string };
  schemaRevision: string;
  rowRevision: string;
  fieldRevision: number;
  identityStatus: BlocksFieldIdentityStatus;
  total: number;
  order: string[];
  blocks: ContentDatabaseBlock[];
  page: { offset: number; limit: number; nextCursor: string | null };
}

export type ContentDatabaseBlockMutationOperation =
  | "insert"
  | "update"
  | "upsert"
  | "delete"
  | "reorder";

export interface ContentDatabaseBlockMutationReceipt {
  receiptId: string;
  operation: ContentDatabaseBlockMutationOperation;
  outcome: "inserted" | "updated" | "deleted" | "reordered" | "unchanged";
  target: ContentDatabaseBlockTarget;
  rowLink: { urlPath: string; label: string };
  schemaRevision: string;
  idempotency: {
    key: string;
    result: "applied" | "replayed";
    payloadDigest: string;
  };
  revisions: {
    row: { before: string; after: string };
    field: { before: number; after: number };
  };
  affected: {
    blockIds: string[];
    deletedBlockIds: string[];
    order: string[];
  };
  readback: {
    verified: true;
    fieldRevision: number;
    contentHash: string;
    order: string[];
    blocks: ContentDatabaseBlock[];
  };
}

export interface ContentDatabaseBlockMutationResult {
  receipt: ContentDatabaseBlockMutationReceipt;
}
