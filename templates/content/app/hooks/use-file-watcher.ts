import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useFileWatcher() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const eventSource = new EventSource("/api/events");

    eventSource.onmessage = () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["document"] });
    };

    eventSource.onerror = (err) => {
      console.error("[FileWatcher] SSE connection error", err);
    };

    return () => {
      eventSource.close();
    };
  }, [queryClient]);
}
