import { MAX_APPROVED_NATIVE_DEFINITION_HASHES } from "@shared/native-effect-trust";

export type NativeApprovalRead =
  | { status: "pending" | "unreadable" }
  | { status: "ready"; hashes: string[] };

export function readNativeApprovalHashes(
  result: unknown,
  designId: string,
  fileId: string,
): NativeApprovalRead {
  if (result === undefined) return { status: "pending" };
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { status: "unreadable" };
  }
  const response = result as Record<string, unknown>;
  if (response.designId !== designId || response.fileId !== fileId) {
    return { status: "unreadable" };
  }
  const hashes = response.approvedDefinitionHashes;
  if (
    !Array.isArray(hashes) ||
    hashes.length > MAX_APPROVED_NATIVE_DEFINITION_HASHES ||
    !hashes.every(
      (hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash),
    ) ||
    new Set(hashes).size !== hashes.length
  ) {
    return { status: "unreadable" };
  }
  return { status: "ready", hashes };
}

export function postNativeApprovalState(
  target: Pick<Window, "postMessage">,
  origin: string,
  approval: NativeApprovalRead,
): void {
  target.postMessage(
    approval.status === "ready"
      ? {
          type: "native-shader-approvals",
          status: "ready",
          hashes: approval.hashes,
        }
      : { type: "native-shader-approvals", status: approval.status },
    origin,
  );
}
