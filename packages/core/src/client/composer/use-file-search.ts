import { useState, useEffect, useRef } from "react";
import type { FileResult } from "./types.js";

export function useFileSearch(query: string, enabled: boolean) {
  const [files, setFiles] = useState<FileResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setFiles([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const id = ++requestIdRef.current;

    const timer = setTimeout(
      async () => {
        try {
          const res = await fetch(
            `/_agent-native/agent-chat/files?q=${encodeURIComponent(query)}`,
          );
          if (!res.ok) throw new Error();
          const data = await res.json();
          // Only update if this is still the latest request
          if (id === requestIdRef.current) {
            setFiles(data.files || []);
          }
        } catch {
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

    return () => clearTimeout(timer);
  }, [query, enabled]);

  return { files, isLoading };
}
