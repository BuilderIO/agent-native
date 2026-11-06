import { useState, useEffect, useRef, useCallback } from "react";

import { useComposerRuntimeAdapters } from "./runtime-adapters.js";
import type { MentionItem } from "./types.js";

function parseMentionBatch(
  line: string,
): { items: MentionItem[] } | { error: Error } {
  const data: unknown = JSON.parse(line);
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    data.error &&
    typeof data.error === "object" &&
    "message" in data.error &&
    typeof data.error.message === "string"
  )
    return { error: new Error(data.error.message) };
  if (
    !data ||
    typeof data !== "object" ||
    !("items" in data) ||
    !Array.isArray(data.items) ||
    !data.items.every(
      (item: unknown) =>
        item &&
        typeof item === "object" &&
        "id" in item &&
        typeof item.id === "string" &&
        "label" in item &&
        typeof item.label === "string" &&
        "refType" in item &&
        typeof item.refType === "string",
    )
  ) {
    throw new Error("Invalid mention search response");
  }
  return { items: data.items as MentionItem[] };
}
export async function loadWorkspaceMentionItems(
  query: string,
  resolvePath: (path: string) => string,
  signal: AbortSignal,
  source?: string,
): Promise<MentionItem[]> {
  const response = await fetch(
    resolvePath(
      `/_agent-native/agent-chat/mentions?q=${encodeURIComponent(query)}${source ? `&source=${encodeURIComponent(source)}` : ""}`,
    ),
    { signal },
  );
  if (!response.ok || !response.body)
    throw new Error("Mention search unavailable");
  const body = await response.text();
  if (signal.aborted)
    throw new DOMException("The operation was aborted.", "AbortError");
  return body
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      const batch = parseMentionBatch(line);
      if ("error" in batch) throw batch.error;
      return batch.items;
    });
}

export function useMentionSearch(
  query: string,
  enabled: boolean,
  resolvePathOverride?: (path: string) => string,
) {
  const { resolvePath = (path) => path } = useComposerRuntimeAdapters();
  const resolveRequestPath = resolvePathOverride ?? resolvePath;
  const [items, setItems] = useState<MentionItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [settledQuery, setSettledQuery] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const id = ++requestIdRef.current;
    setError(null);
    if (!enabled) {
      setItems([]);
      setIsLoading(false);
      setSettledQuery(null);
      return;
    }

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setItems([]);
    setIsLoading(true);
    setSettledQuery(null);

    const debounceMs = query.length === 0 ? 0 : 150;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          resolveRequestPath(
            `/_agent-native/agent-chat/mentions?q=${encodeURIComponent(query)}`,
          ),
          { signal: abort.signal },
        );
        if (!res.ok || !res.body) throw new Error("Mention search unavailable");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const sourceError: { current: Error | null } = { current: null };
        const receive = (line: string) => {
          if (!line.trim()) return;
          const batch = parseMentionBatch(line);
          if ("error" in batch) {
            sourceError.current ??= batch.error;
            return;
          }
          if (id !== requestIdRef.current || abort.signal.aborted) return;
          setItems((previous) => {
            const seen = new Set(previous.map((item) => item.id));
            return [
              ...previous,
              ...batch.items.filter((item) => {
                if (seen.has(item.id)) return false;
                seen.add(item.id);
                return true;
              }),
            ];
          });
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            receive(buf + decoder.decode());
            break;
          }

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop()!;

          for (const line of lines) {
            receive(line);
          }
        }
        // Only a completed search settles its query: a failed one is unknown,
        // not empty, and must not read as "nothing matches".
        if (id === requestIdRef.current && !abort.signal.aborted) {
          if (sourceError.current) setError(sourceError.current);
          else setSettledQuery(query);
        }
      } catch (err: unknown) {
        if (abort.signal.aborted) return;
        if (id === requestIdRef.current)
          setError(
            err instanceof Error ? err : new Error("Mention search failed"),
          );
      } finally {
        if (id === requestIdRef.current && !abort.signal.aborted)
          setIsLoading(false);
      }
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, enabled, resolveRequestPath, revision]);

  return { items, isLoading, error, retry, settledQuery };
}
