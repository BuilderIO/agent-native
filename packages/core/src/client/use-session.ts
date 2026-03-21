import { useState, useEffect } from "react";
import type { AuthSession } from "../server/auth.js";

export type { AuthSession };

interface UseSessionResult {
  session: AuthSession | null;
  isLoading: boolean;
}

/**
 * Client-side hook to get the current auth session.
 *
 * - In dev mode: immediately returns { email: "local@localhost" }
 * - In production: fetches /api/auth/session and returns the result
 *
 * Templates should use this instead of building their own auth context.
 */
export function useSession(): UseSessionResult {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchSession() {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) {
          setSession(null);
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          // The endpoint returns { error: "..." } when not authenticated
          if (data.error) {
            setSession(null);
          } else {
            setSession(data as AuthSession);
          }
        }
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchSession();
    return () => {
      cancelled = true;
    };
  }, []);

  return { session, isLoading };
}
