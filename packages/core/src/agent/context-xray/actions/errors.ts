import type { ContextManifest } from "../../../shared/context-xray.js";

export class ContextXrayActionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "ContextXrayActionError";
  }
}

export function contextXrayAuthError(): ContextXrayActionError {
  return new ContextXrayActionError(
    "Context X-Ray requires a signed-in user.",
    401,
  );
}

export function contextXrayThreadNotFoundError(): ContextXrayActionError {
  return new ContextXrayActionError("Thread not found.", 404);
}

export function contextXraySystemSegmentError(): ContextXrayActionError {
  return new ContextXrayActionError(
    "System Context X-Ray sections are required and cannot be pinned, evicted, or restored.",
    400,
  );
}

export function isContextXraySystemSegment(
  manifest: ContextManifest | null,
  segmentId: string,
): boolean {
  return (
    manifest?.systemSections?.some(
      (section) => section.segmentId === segmentId,
    ) ?? false
  );
}
