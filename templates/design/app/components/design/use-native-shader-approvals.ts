import { useActionQuery, useSession } from "@agent-native/core/client/hooks";
import { parseNativeEffectApprovalState } from "@shared/native-effect-trust";
import { useCallback, useEffect, useMemo, useRef } from "react";

type ApprovalMessage =
  | { type: "native-shader-approvals"; status: "ready"; hashes: string[] }
  | { type: "native-shader-approvals"; status: "pending" | "unreadable" };

const EMPTY_HASHES: readonly string[] = [];

export function useNativeShaderApprovals({
  designId,
  fileId,
  enabled,
}: {
  designId: string | undefined;
  fileId: string | undefined;
  enabled: boolean;
}) {
  const { session } = useSession();
  const active = enabled && Boolean(session?.email && designId && fileId);
  const query = useActionQuery(
    "get-shader",
    { format: "native-v2", source: { kind: "design-file", designId, fileId } },
    { enabled: active },
  );
  const sourceKey = JSON.stringify([designId, fileId, active]);
  const frames = useRef({ sourceKey, items: new Set<HTMLIFrameElement>() });
  if (frames.current.sourceKey !== sourceKey)
    frames.current = { sourceKey, items: new Set() };
  const message = useMemo<ApprovalMessage>(() => {
    if (!active) return { type: "native-shader-approvals", status: "pending" };
    if (query.error)
      return { type: "native-shader-approvals", status: "unreadable" };
    if (!query.data)
      return { type: "native-shader-approvals", status: "pending" };
    if (!("approvedDefinitionHashes" in query.data))
      return { type: "native-shader-approvals", status: "unreadable" };
    if (query.data.designId !== designId || query.data.fileId !== fileId)
      return { type: "native-shader-approvals", status: "pending" };
    try {
      const approvals = parseNativeEffectApprovalState({
        schemaVersion: 1,
        hashes: query.data.approvedDefinitionHashes,
      });
      return {
        type: "native-shader-approvals",
        status: "ready",
        hashes: approvals.hashes,
      };
    } catch {
      return { type: "native-shader-approvals", status: "unreadable" };
    }
  }, [active, designId, fileId, query.data, query.error]);
  const approvedHashesRef = useRef<readonly string[]>(EMPTY_HASHES);
  const nextHashes = message.status === "ready" ? message.hashes : EMPTY_HASHES;
  if (
    approvedHashesRef.current.length !== nextHashes.length ||
    approvedHashesRef.current.some((hash, index) => hash !== nextHashes[index])
  )
    approvedHashesRef.current = nextHashes;
  const syncFrame = useCallback(
    (frame: HTMLIFrameElement) => {
      if (!active) return;
      frames.current.items.add(frame);
      frame.contentWindow?.postMessage(message, "*");
    },
    [active, message],
  );
  useEffect(() => {
    if (!active) return;
    for (const frame of frames.current.items) {
      if (!frame.isConnected) frames.current.items.delete(frame);
      else frame.contentWindow?.postMessage(message, "*");
    }
  }, [active, message]);
  return {
    syncFrame,
    approvedDefinitionHashes: approvedHashesRef.current,
  };
}
