import { useState, useEffect, useRef } from "react";
import type { MentionItem } from "./types.js";

export function useMentionSearch(query: string, enabled: boolean) {
  const [items, setItems] = useState<MentionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const id = ++requestIdRef.current;

    const timer = setTimeout(
      async () => {
        try {
          const res = await fetch(
            `/_agent-native/agent-chat/mentions?q=${encodeURIComponent(query)}`,
          );
          if (!res.ok) throw new Error();
          const data = await res.json();
          if (id === requestIdRef.current) {
            setItems(data.items || []);
          }
        } catch {
          if (id === requestIdRef.current) {
            setItems([]);
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

  return { items, isLoading };
}
