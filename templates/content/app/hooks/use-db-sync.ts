import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useDbSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["action"] });
    }, 2000);

    return () => {
      clearInterval(interval);
    };
  }, [queryClient]);
}
