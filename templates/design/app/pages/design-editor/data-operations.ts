import type {
  CanvasFrameGeometry,
  CanvasFrameGeometryById,
} from "@shared/canvas-frames";

export const KEEPALIVE_ACTION_MAX_BYTES = 60_000;

export type DesignDataOperation =
  | {
      op: "set";
      path: [string, ...string[]];
      value: unknown;
    }
  | {
      op: "delete";
      path: [string, ...string[]];
    };

export interface PendingDesignDataOperation {
  operation: DesignDataOperation;
  revision: number;
  order: number;
}

export type PendingDesignDataOperations = Record<
  string,
  PendingDesignDataOperation
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordValue(
  data: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = data[key];
  return isRecord(value) ? value : {};
}

function operationPathKey(operation: DesignDataOperation): string {
  return JSON.stringify(operation.path);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function viewportSizeFromFrameGeometry(
  geometry: CanvasFrameGeometry | undefined,
): { width: number; height: number } | null {
  if (
    typeof geometry?.width !== "number" ||
    !Number.isFinite(geometry.width) ||
    typeof geometry.height !== "number" ||
    !Number.isFinite(geometry.height)
  ) {
    return null;
  }
  return {
    width: Math.max(1, Math.round(geometry.width)),
    height: Math.max(1, Math.round(geometry.height)),
  };
}

export function buildFrameGeometryDataOperations(args: {
  previousGeometry: CanvasFrameGeometryById;
  nextGeometry: CanvasFrameGeometryById;
  designData: Record<string, unknown>;
  syncViewportFrameIds?: readonly string[];
}): DesignDataOperation[] {
  const operations: DesignDataOperation[] = [];
  const frameIds = new Set([
    ...Object.keys(args.previousGeometry),
    ...Object.keys(args.nextGeometry),
  ]);

  for (const frameId of frameIds) {
    const previous = args.previousGeometry[frameId];
    const next = args.nextGeometry[frameId];
    if (valuesEqual(previous, next)) continue;
    if (next === undefined) {
      operations.push({ op: "delete", path: ["canvasFrames", frameId] });
    } else {
      operations.push({
        op: "set",
        path: ["canvasFrames", frameId],
        value: { ...next },
      });
    }
  }

  const screenMetadata = recordValue(args.designData, "screenMetadata");
  const localhostScreens = recordValue(args.designData, "localhostScreens");
  for (const frameId of new Set(args.syncViewportFrameIds ?? [])) {
    const viewport = viewportSizeFromFrameGeometry(args.nextGeometry[frameId]);
    if (!viewport) continue;
    const metadataEntry = recordValue(screenMetadata, frameId);
    if (metadataEntry.width !== viewport.width) {
      operations.push({
        op: "set",
        path: ["screenMetadata", frameId, "width"],
        value: viewport.width,
      });
    }
    if (metadataEntry.height !== viewport.height) {
      operations.push({
        op: "set",
        path: ["screenMetadata", frameId, "height"],
        value: viewport.height,
      });
    }

    const localhostEntry = recordValue(localhostScreens, frameId);
    if (Object.keys(localhostEntry).length === 0) continue;
    if (localhostEntry.width !== viewport.width) {
      operations.push({
        op: "set",
        path: ["localhostScreens", frameId, "width"],
        value: viewport.width,
      });
    }
    if (localhostEntry.height !== viewport.height) {
      operations.push({
        op: "set",
        path: ["localhostScreens", frameId, "height"],
        value: viewport.height,
      });
    }
  }

  return operations;
}

export function applyDesignDataOperations(
  data: Record<string, unknown>,
  operations: readonly DesignDataOperation[],
): Record<string, unknown> {
  const root = { ...data };
  for (const operation of operations) {
    let target = root;
    let missingDeleteParent = false;
    for (const segment of operation.path.slice(0, -1)) {
      const current = target[segment];
      if (current === undefined) {
        if (operation.op === "delete") {
          missingDeleteParent = true;
          break;
        }
        const next: Record<string, unknown> = {};
        target[segment] = next;
        target = next;
        continue;
      }
      if (!isRecord(current)) {
        throw new Error(
          `Cannot apply design data operation through non-object path "${operation.path.join(".")}".`,
        );
      }
      const cloned = { ...current };
      target[segment] = cloned;
      target = cloned;
    }
    if (missingDeleteParent) continue;
    const leaf = operation.path[operation.path.length - 1]!;
    if (operation.op === "delete") delete target[leaf];
    else target[leaf] = operation.value;
  }
  return root;
}

export function compactDesignDataOperations(
  operations: readonly DesignDataOperation[],
): DesignDataOperation[] {
  const byPath = new Map<string, DesignDataOperation>();
  for (const operation of operations) {
    const key = operationPathKey(operation);
    byPath.delete(key);
    byPath.set(key, operation);
  }
  return [...byPath.values()];
}

export function stagePendingDesignDataOperations(
  pending: PendingDesignDataOperations,
  operations: readonly DesignDataOperation[],
  revision: number,
): PendingDesignDataOperations {
  const next = { ...pending };
  operations.forEach((operation, order) => {
    next[operationPathKey(operation)] = { operation, revision, order };
  });
  return next;
}

export function clearAcknowledgedDesignDataOperations(
  pending: PendingDesignDataOperations,
  operations: readonly DesignDataOperation[],
  revision: number,
): PendingDesignDataOperations {
  const next = { ...pending };
  for (const operation of operations) {
    const key = operationPathKey(operation);
    if (next[key]?.revision === revision) delete next[key];
  }
  return next;
}

/**
 * Clears every operation included in a compacted save through `revision`
 * while preserving edits that entered the queue after that request began.
 */
export function clearAcknowledgedDesignDataOperationsThroughRevision(
  pending: PendingDesignDataOperations,
  revision: number,
): PendingDesignDataOperations {
  return Object.fromEntries(
    Object.entries(pending).filter(
      ([, operation]) => operation.revision > revision,
    ),
  );
}

export function pendingDesignDataOperations(
  pending: PendingDesignDataOperations,
): DesignDataOperation[] {
  return Object.values(pending)
    .sort(
      (left, right) =>
        left.revision - right.revision || left.order - right.order,
    )
    .map(({ operation }) => operation);
}

function byteLength(value: string): number {
  if (typeof TextEncoder === "undefined") return value.length;
  return new TextEncoder().encode(value).length;
}

export function buildDataOperationsKeepalivePayload(
  designId: string | undefined,
  operations: readonly DesignDataOperation[],
  operationSource: string,
  operationRevision: number,
  maxBytes = KEEPALIVE_ACTION_MAX_BYTES,
): {
  id: string;
  dataOperations: DesignDataOperation[];
  operationSource: string;
  operationRevision: number;
} | null {
  if (!designId) return null;
  const dataOperations = compactDesignDataOperations(operations);
  if (dataOperations.length === 0) return null;
  if (
    !operationSource ||
    !Number.isSafeInteger(operationRevision) ||
    operationRevision < 0
  ) {
    return null;
  }
  const payload = {
    id: designId,
    dataOperations,
    operationSource,
    operationRevision,
  };
  return byteLength(JSON.stringify(payload)) <= maxBytes ? payload : null;
}
