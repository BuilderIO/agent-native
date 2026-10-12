import { designSourceTypeFromData } from "../shared/source-mode.js";

const SHA256_VERSION_HASH = /^[a-f0-9]{64}$/i;

export class MotionLocalSourceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MotionLocalSourceError";
  }
}

export interface MotionLocalSourceLocation {
  screenId: string;
  connectionId: string;
  filePath: string;
}

export interface MotionLocalSourceRoute {
  screenId: string;
  connectionId: string;
  sourceFile: string;
}

export interface MotionLocalSourceDeclaration {
  connectionId?: string;
  filePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseDesignData(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    if (isRecord(value)) return value;
    throw new MotionLocalSourceError(
      "invalid-design-data",
      "The Design source metadata is unavailable or malformed.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new MotionLocalSourceError(
      "invalid-design-data",
      "The Design source metadata is invalid JSON.",
    );
  }
  if (isRecord(parsed)) return parsed;
  throw new MotionLocalSourceError(
    "invalid-design-data",
    "The Design source metadata is malformed.",
  );
}

/** Resolves a screen only through its saved sourceFile metadata, never its route URL. */
export function resolveMotionLocalSourceRoute(args: {
  designData: unknown;
  screenId: string;
  declarationConnectionId?: string;
}): MotionLocalSourceRoute {
  const data = parseDesignData(args.designData);
  if (designSourceTypeFromData(data) !== "localhost") {
    throw new MotionLocalSourceError(
      "not-localhost-source",
      "Motion source writeback requires a connected localhost Design source.",
    );
  }

  const screenMetadata = isRecord(data.screenMetadata)
    ? data.screenMetadata[args.screenId]
    : undefined;
  const legacyMetadata = isRecord(data.localhostScreens)
    ? data.localhostScreens[args.screenId]
    : undefined;
  const records = [screenMetadata, legacyMetadata].filter(isRecord);
  if (records.length === 0) {
    throw new MotionLocalSourceError(
      "missing-screen-metadata",
      `No localhost source metadata is recorded for screen "${args.screenId}".`,
    );
  }
  if (
    records.some(
      (record) =>
        record.sourceType !== undefined && record.sourceType !== "localhost",
    )
  ) {
    throw new MotionLocalSourceError(
      "invalid-screen-metadata",
      "The selected screen is not recorded as a localhost source.",
    );
  }

  const filePaths = new Set(
    records
      .map((record) => record.sourceFile)
      .filter((value): value is string => typeof value === "string"),
  );
  if (filePaths.size !== 1) {
    throw new MotionLocalSourceError(
      "ambiguous-source-file",
      "The selected localhost screen does not map to one saved source file.",
    );
  }
  const filePath = [...filePaths][0].trim();
  if (!/\.(?:tsx|jsx|html?)$/i.test(filePath)) {
    throw new MotionLocalSourceError(
      "unsupported-source-file",
      "Motion source writeback supports .tsx, .jsx, .html, and .htm files only.",
    );
  }

  const connectionIds = new Set(
    records
      .map((record) => record.connectionId)
      .filter((value): value is string => typeof value === "string"),
  );
  if (connectionIds.size === 0 && typeof data.connectionId === "string") {
    connectionIds.add(data.connectionId);
  }
  if (connectionIds.size !== 1) {
    throw new MotionLocalSourceError(
      "ambiguous-connection",
      "The selected localhost screen does not map to one bridge connection.",
    );
  }
  const connectionId = [...connectionIds][0].trim();
  if (!connectionId || !filePath) {
    throw new MotionLocalSourceError(
      "incomplete-source-metadata",
      "The selected localhost screen is missing its source file or bridge connection.",
    );
  }

  if (
    args.declarationConnectionId &&
    args.declarationConnectionId !== connectionId
  ) {
    throw new MotionLocalSourceError(
      "source-metadata-mismatch",
      "The requested React source does not match the selected localhost bridge connection.",
    );
  }

  if (!isSafeRelativeMotionSourcePath(filePath)) {
    throw new MotionLocalSourceError(
      "unsupported-source-file",
      "Motion source writeback requires a project-relative .tsx/.jsx module or .html/.htm page.",
    );
  }

  return { screenId: args.screenId, connectionId, sourceFile: filePath };
}

/** Resolves the requested module candidate; bridge graph verification proves membership. */
export function resolveMotionLocalSourceLocation(args: {
  designData: unknown;
  screenId: string;
  declaration?: MotionLocalSourceDeclaration;
}): MotionLocalSourceLocation {
  const route = resolveMotionLocalSourceRoute({
    designData: args.designData,
    screenId: args.screenId,
    declarationConnectionId: args.declaration?.connectionId,
  });

  const requestedFilePath = args.declaration?.filePath ?? route.sourceFile;
  if (!isSafeRelativeMotionSourcePath(requestedFilePath)) {
    throw new MotionLocalSourceError(
      "unsupported-source-file",
      "Motion source writeback requires a project-relative .tsx/.jsx module or .html/.htm page path.",
    );
  }

  return {
    screenId: args.screenId,
    connectionId: route.connectionId,
    filePath: requestedFilePath,
  };
}

function isSafeRelativeMotionSourcePath(value: string): boolean {
  const path = value.trim();
  if (
    !path ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    /[\u0000-\u001f]/.test(path) ||
    !/\.(?:tsx|jsx|html?)$/i.test(path)
  ) {
    return false;
  }
  return path
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function isBridgeSha256VersionHash(value: unknown): value is string {
  return typeof value === "string" && SHA256_VERSION_HASH.test(value);
}
