import { useState, useEffect, useRef } from "react";
import type { MentionItem } from "./types.js";

export function useMentionSearch(query: string, enabled: boolean) {
  const [items, setItems] = useState<MentionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    // Cancel any in-flight stream
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const id = ++requestIdRef.current;

    setItems([]);
    setIsLoading(true);

    const debounceMs = query.length === 0 ? 0 : 150;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/_agent-native/agent-chat/mentions?q=${encodeURIComponent(query)}`,
          { signal: abort.signal },
        );
        if (!res.ok || !res.body) throw new Error();

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop()!; // last line may be incomplete

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const { items: batch } = JSON.parse(line) as {
                items: MentionItem[];
              };
              if (id === requestIdRef.current && batch?.length) {
                setItems((prev) => {
                  // Deduplicate by id
                  const seen = new Set(prev.map((x) => x.id));
                  const fresh = batch.filter((x) => !seen.has(x.id));
                  return fresh.length ? [...prev, ...fresh] : prev;
                });
              }
            } catch {}
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (id === requestIdRef.current) setItems([]);
      } finally {
        if (id === requestIdRef.current) setIsLoading(false);
      }
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, enabled]);

  return { items, isLoading };
}
