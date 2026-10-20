import { useActionQuery } from "@agent-native/core/client/hooks";
import { parseNativeEffectApprovalState } from "@shared/native-effect-trust";
import { useCallback, useEffect, useMemo, useRef } from "react";

type ApprovalMessage =
  | { type: "native-shader-approvals"; status: "ready"; hashes: string[] }
  | { type: "native-shader-approvals"; status: "pending" | "unreadable" };

export function useNativeShaderApprovals({
  designId,
  fileId,
  enabled,
}: {
  designId: string | undefined;
  fileId: string | undefined;
  enabled: boolean;
}) {
  const active = enabled && Boolean(designId && fileId);
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
  }, [designId, fileId, query.data, query.error]);
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
  return syncFrame;
}
