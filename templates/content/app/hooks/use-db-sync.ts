import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useDbSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const eventSource = new EventSource("/_agent-native/events");

    eventSource.onmessage = () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["document"] });
    };

    eventSource.onerror = () => {
      // SSE may fail in serverless/edge — polling below covers it
    };

    // Polling fallback: periodically invalidate queries so React Query
    // refetches from the API. If the data hasn't changed, React Query's
    // structural sharing means no re-render occurs.
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["document"] });
    }, 2000);

    return () => {
      clearInterval(interval);
      eventSource.close();
    };
  }, [queryClient]);
}
