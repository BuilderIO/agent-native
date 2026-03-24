import { useState, useEffect, useRef } from "react";
import type { AuthSession } from "../server/auth.js";
import { trackSessionStatus } from "./analytics.js";

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
  const trackedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchSession() {
      let signedIn = false;
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
            signedIn = true;
          }
        }
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          if (!trackedRef.current) {
            trackedRef.current = true;
            trackSessionStatus(signedIn);
          }
        }
      }
    }

    fetchSession();
    return () => {
      cancelled = true;
    };
  }, []);

  return { session, isLoading };
}
