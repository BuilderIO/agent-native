import * as React from "react";

type SearchState<Item> = {
  status: "idle" | "pending" | "ready" | "error";
  results: Item[];
};

export function useAsyncOptions<Item>(
  load: (query: string, signal: AbortSignal) => Promise<Item[]>,
  debounceMs = 0,
) {
  const [state, setState] = React.useState<SearchState<Item>>({
    status: "idle",
    results: [],
  });
  const active = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => active.current?.abort(), []);

  async function search(query: string) {
    active.current?.abort();
    if (!query.trim()) {
      active.current = null;
      setState({ status: "idle", results: [] });
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setState({ status: "pending", results: [] });
    try {
      if (debounceMs > 0) {
        await searchDelay(controller.signal, debounceMs);
        controller.signal.throwIfAborted();
      }
      const results = await load(query.trim(), controller.signal);
      if (!controller.signal.aborted) setState({ status: "ready", results });
    } catch {
      if (!controller.signal.aborted)
        setState({ status: "error", results: [] });
    } finally {
      if (active.current === controller) active.current = null;
    }
  }
  return { ...state, search };
}

export function searchDelay(signal: AbortSignal, durationMs: number) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, durationMs);
    function cancel() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", cancel, { once: true });
  });
}
