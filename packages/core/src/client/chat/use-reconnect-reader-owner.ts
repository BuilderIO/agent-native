import { useEffect, useRef } from "react";

type MutableRef<T> = { current: T };

/**
 * Owns the lifetime of AssistantChat's reconnect reader. The inner chat can be
 * remounted while its outer runtime survives (error-boundary recovery, keyed
 * thread changes), so unmount must explicitly retire the old reader.
 */
export function useReconnectReaderOwner(
  reconnectRunIdRef: MutableRef<string | null>,
  reconnectAbortRef: MutableRef<AbortController | null>,
  onCleanup?: (ownerThreadId?: string | null) => void,
  threadId?: string | null,
): MutableRef<boolean> {
  const mountedRef = useRef(false);
  const onCleanupRef = useRef(onCleanup);
  onCleanupRef.current = onCleanup;

  useEffect(() => {
    mountedRef.current = true;
    const ownerThreadId = threadId;
    return () => {
      mountedRef.current = false;
      onCleanupRef.current?.(ownerThreadId);
      const reconnectAbort = reconnectAbortRef.current;
      reconnectRunIdRef.current = null;
      reconnectAbortRef.current = null;
      reconnectAbort?.abort();
    };
  }, [reconnectAbortRef, reconnectRunIdRef, threadId]);

  return mountedRef;
}
