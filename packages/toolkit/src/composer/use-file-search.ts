import { useState, useEffect, useRef } from "react";

import { agentNativePath } from "../api-path.js";
import type { FileResult } from "./types.js";

export function useFileSearch(query: string, enabled: boolean) {
  const [files, setFiles] = useState<FileResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) {
      setFiles([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const id = ++requestIdRef.current;
    // Abort any in-flight request so a superseded/unmounted query stops fetching
    // (mirrors use-mention-search). The requestId guard still protects state.
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    const timer = setTimeout(
      async () => {
        try {
          const res = await fetch(
            agentNativePath(
              `/_agent-native/agent-chat/files?q=${encodeURIComponent(query)}`,
            ),
            { signal: abort.signal },
          );
          if (!res.ok) throw new Error();
          const data = await res.json();
          // Only update if this is still the latest request
          if (id === requestIdRef.current) {
            setFiles(data.files || []);
          }
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return;
          if (id === requestIdRef.current) {
            setFiles([]);
          }
        } finally {
          if (id === requestIdRef.current) {
            setIsLoading(false);
          }
        }
      },
      query.length === 0 ? 0 : 200,
    );

    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, enabled]);

  return { files, isLoading };
}
