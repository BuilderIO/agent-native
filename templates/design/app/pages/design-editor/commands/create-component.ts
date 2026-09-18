import type { LocalJsxSourceAnchor } from "@shared/local-jsx-visual-edit";
import { sourceContentHash } from "@shared/source-workspace";

import type {
  ContentHistoryChange,
  GeometryHistorySelection,
} from "../history";

export interface CreateComponentSourcePreimage {
  content: string;
  versionHash: string;
}

export interface CreateComponentLocalSource extends LocalJsxSourceAnchor {
  connectionId: string;
  path: string;
  expectedVersionHash?: string;
  propStamps?: Array<{ name: string; value: string }>;
}

export interface CreateComponentRequest {
  designId: string;
  nodeId?: string;
  selector?: string;
  name: string;
  fileId?: string;
  source?: {
    currentContent?: string;
    expectedVersionHash?: string;
    local?: CreateComponentLocalSource;
  };
}

export interface CreateComponentActionChange {
  fileId: string;
  before: string;
  after: string;
  beforeVersionHash: string;
  afterVersionHash: string;
  updatedAt: string;
}

/** The action receipt is intentionally source-addressed so a queue can adopt
 * the exact server write without treating a refetched document as proof. */
export interface CreateComponentActionResult {
  persisted?: boolean;
  conflict?: boolean;
  ctaRequired?: boolean;
  ctaMessage?: string;
  error?: string;
  fileId?: string;
  nodeId?: string;
  selector?: string;
  componentName?: string;
  changes?: CreateComponentActionChange[];
  sourceBases?: Array<{
    fileId: string;
    versionHash: string;
    updatedAt: string;
  }>;
  source?: {
    kind: "local-file";
    connectionId: string;
    path: string;
    versionHash: string;
  };
  updatedAt?: string;
}

export interface CreateComponentCommandOutcome {
  result: CreateComponentActionResult;
  historyRecorded: boolean;
  change?: ContentHistoryChange;
  hostSync: "skipped" | "accepted" | "deferred" | "refused";
}

/**
 * The linked mutation queue owns this transaction. It provides the source
 * preimage while its file-save gate is held, runs the action, validates its
 * receipt, commits one history entry, and adopts the receipt locally. Keeping
 * that lifecycle outside this command prevents Create Component from growing
 * a second save coordinator beside linked component edits.
 */
export interface CreateComponentMutationTransaction {
  enqueue: (args: {
    fileId: string;
    selectionBefore?: GeometryHistorySelection;
    run: (
      source: CreateComponentSourcePreimage,
    ) => Promise<CreateComponentActionResult>;
  }) => Promise<CreateComponentCommandOutcome>;
}

export interface CreateComponentArgs {
  canEditDesign: boolean;
  createComponent: (
    request: CreateComponentRequest,
  ) => Promise<CreateComponentActionResult>;
  designId: string;
  fileId: string;
  mutationTransaction: CreateComponentMutationTransaction;
  selectionBefore?: GeometryHistorySelection;
}

function createComponentReceiptError(message: string): Error {
  return new Error(
    `Create Component returned an invalid source receipt: ${message}`,
  );
}

/**
 * Validate the exact one-file receipt returned by the Create Component
 * action. Queue code uses this before committing its reserved history entry.
 * A persisted result without an exact matching preimage is never accepted.
 */
export function createComponentActionChange(
  result: CreateComponentActionResult,
  source: CreateComponentSourcePreimage & { fileId: string },
): CreateComponentActionChange | null {
  if (result.conflict || result.error || result.ctaRequired) {
    return null;
  }
  if (result.persisted !== true) {
    if (result.changes && result.changes.length > 0) {
      throw createComponentReceiptError(
        "a non-persisted result included source changes",
      );
    }
    return null;
  }
  if (result.fileId !== undefined && result.fileId !== source.fileId) {
    throw createComponentReceiptError(
      "the file id does not match the preimage",
    );
  }
  if (!result.changes || result.changes.length !== 1) {
    throw createComponentReceiptError(
      "a persisted result must include exactly one file change",
    );
  }
  const [change] = result.changes;
  if (
    !change ||
    change.fileId !== source.fileId ||
    change.before !== source.content ||
    change.beforeVersionHash !== source.versionHash ||
    change.after === change.before ||
    sourceContentHash(change.before) !== change.beforeVersionHash ||
    sourceContentHash(change.after) !== change.afterVersionHash ||
    !change.updatedAt
  ) {
    throw createComponentReceiptError(
      "the before/after content or source version is stale",
    );
  }
  if (
    !result.sourceBases ||
    result.sourceBases.length !== 1 ||
    result.sourceBases[0]?.fileId !== source.fileId ||
    result.sourceBases[0]?.versionHash !== change.afterVersionHash ||
    result.sourceBases[0]?.updatedAt !== change.updatedAt
  ) {
    throw createComponentReceiptError(
      "the persisted source version set is incomplete or stale",
    );
  }
  return change;
}

/** Build the command-side request and hand it to the queue-owned transaction. */
export async function runCreateComponent(
  args: CreateComponentArgs,
  request: Omit<CreateComponentRequest, "designId" | "fileId" | "source"> & {
    source?: { local?: CreateComponentLocalSource };
  },
): Promise<CreateComponentCommandOutcome | undefined> {
  if (!args.canEditDesign) return undefined;

  if (request.source?.local) {
    const result = await args.createComponent({
      ...request,
      designId: args.designId,
      fileId: args.fileId,
      source: { local: request.source.local },
    });
    return {
      result,
      historyRecorded: result.persisted === true,
      hostSync: result.persisted === true ? "accepted" : "skipped",
    };
  }

  return args.mutationTransaction.enqueue({
    fileId: args.fileId,
    selectionBefore: args.selectionBefore,
    run: (source) =>
      args.createComponent({
        ...request,
        designId: args.designId,
        fileId: args.fileId,
        source: {
          currentContent: source.content,
          expectedVersionHash: source.versionHash,
          ...(request.source?.local
            ? {
                local: {
                  ...request.source.local,
                  expectedVersionHash:
                    request.source.local.expectedVersionHash ??
                    source.versionHash,
                },
              }
            : {}),
        },
      }),
  });
}
