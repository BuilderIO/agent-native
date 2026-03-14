import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useFileWatcher() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const eventSource = new EventSource("/api/events");

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[FileWatcher] event received:", data);
        
        // Invalidate relevant react-query caches
        queryClient.invalidateQueries({ queryKey: ["file"] });
        queryClient.invalidateQueries({ queryKey: ["fileTree"] });
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        queryClient.invalidateQueries({ queryKey: ["versionHistory"] });
        queryClient.invalidateQueries({ queryKey: ["versionContent"] });
      } catch (err) {
        console.error("[FileWatcher] error parsing event data", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("[FileWatcher] SSE connection error", err);
    };

    return () => {
      eventSource.close();
    };
  }, [queryClient]);
}
