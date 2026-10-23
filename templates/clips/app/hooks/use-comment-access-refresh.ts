import { useEffect } from "react";

export function useCommentAccessRefresh(
  token: string | null | undefined,
  refresh: () => Promise<unknown>,
): void {
  useEffect(() => {
    if (!token) return;
    const renew = () => void refresh();
    const renewWhenVisible = () => {
      if (document.visibilityState === "visible") renew();
    };
    // Finished shares stop media polling, but password comment proof expires in ten minutes.
    const timer = setInterval(renew, 5 * 60_000);
    window.addEventListener("focus", renew);
    document.addEventListener("visibilitychange", renewWhenVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", renew);
      document.removeEventListener("visibilitychange", renewWhenVisible);
    };
  }, [token, refresh]);
}
