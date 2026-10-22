import type { ClaimedEditorSave } from "./editor-save-state.js";

export const DOCUMENT_FLUSH_PROTOCOL = 2;

export type FlushEditorIdentity = {
  clientId: number;
  editorSessionId: string;
};

export type DocumentFlushRequest = {
  protocol: typeof DOCUMENT_FLUSH_PROTOCOL;
  id: string;
  requestId: string;
  phase: "prepare" | "verify";
  phaseToken: string;
  prepareToken: string;
  expiresAt: number;
  targets: FlushEditorIdentity[];
  propertyId?: string;
};

export type DocumentFlushClaim =
  | { kind: "document"; save: ClaimedEditorSave }
  | { kind: "property"; propertyId: string; contentHash: string };

export type DocumentFlushAck = FlushEditorIdentity & {
  protocol: typeof DOCUMENT_FLUSH_PROTOCOL;
  id: string;
  requestId: string;
  phaseToken: string;
  phase: "prepare" | "verify";
} & (
    | { status: "prepared"; stabilityToken: string; claim: DocumentFlushClaim }
    | { status: "verified"; stabilityToken: string }
    | { status: "changed" }
    | { status: "error"; errorCode: string }
  );

export function flushAckKey(
  request: Pick<DocumentFlushRequest, "id" | "requestId" | "phaseToken">,
  clientId: number,
): string {
  return `flush-ack-${request.id}-${request.requestId}-${request.phaseToken}-${clientId}`;
}

export function isDocumentFlushRequest(
  value: unknown,
): value is DocumentFlushRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as DocumentFlushRequest;
  return (
    request.protocol === DOCUMENT_FLUSH_PROTOCOL &&
    typeof request.id === "string" &&
    typeof request.requestId === "string" &&
    (request.phase === "prepare" || request.phase === "verify") &&
    typeof request.phaseToken === "string" &&
    typeof request.prepareToken === "string" &&
    Number.isFinite(request.expiresAt) &&
    (request.propertyId === undefined ||
      typeof request.propertyId === "string") &&
    Array.isArray(request.targets) &&
    request.targets.length > 0 &&
    request.targets.every(
      (target) =>
        target !== null &&
        typeof target === "object" &&
        Number.isSafeInteger(target.clientId) &&
        typeof target.editorSessionId === "string" &&
        target.editorSessionId.length > 0,
    )
  );
}

export function matchingFlushAck(
  value: Record<string, unknown>,
  request: DocumentFlushRequest,
  target: FlushEditorIdentity,
): boolean {
  return (
    value.protocol === DOCUMENT_FLUSH_PROTOCOL &&
    value.id === request.id &&
    value.requestId === request.requestId &&
    value.phase === request.phase &&
    value.phaseToken === request.phaseToken &&
    value.clientId === target.clientId &&
    value.editorSessionId === target.editorSessionId
  );
}
