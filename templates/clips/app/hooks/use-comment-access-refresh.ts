import { useEffect } from "react";

export function useCommentAccessRefresh(
  token: string | null | undefined,
  refresh: () => Promise<unknown>,
): void {
  useEffect(() => {
    if (!token) return;
    // Finished shares stop media polling, but password comment proof expires in ten minutes.
    const timer = setInterval(() => void refresh(), 5 * 60_000);
    return () => clearInterval(timer);
  }, [token, refresh]);
}
