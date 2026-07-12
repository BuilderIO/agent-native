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
): MutableRef<boolean> {
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const reconnectAbort = reconnectAbortRef.current;
      reconnectRunIdRef.current = null;
      reconnectAbortRef.current = null;
      reconnectAbort?.abort();
    };
  }, [reconnectAbortRef, reconnectRunIdRef]);

  return mountedRef;
}
