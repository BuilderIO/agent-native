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

    eventSource.onerror = (err) => {
      console.error("[DbSync] SSE connection error", err);
    };

    return () => {
      eventSource.close();
    };
  }, [queryClient]);
}
