import { useState, useEffect, useRef } from "react";
import type { AuthSession } from "../server/auth.js";
import { setSentryUser, trackSessionStatus } from "./analytics.js";
import { agentNativePath } from "./api-path.js";

export type { AuthSession };

interface UseSessionResult {
  session: AuthSession | null;
  isLoading: boolean;
}

/**
 * Client-side hook to get the current auth session.
 *
 * - In dev mode: immediately returns { email: "local@localhost" }
 * - In production: fetches /_agent-native/auth/session and returns the result
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
      let resolved: AuthSession | null = null;
      try {
        const res = await fetch(agentNativePath("/_agent-native/auth/session"));
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
            resolved = data as AuthSession;
            setSession(resolved);
            signedIn = true;
          }
        }
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          if (resolved) {
            setSentryUser(
              {
                id: resolved.userId,
                email: resolved.email,
                username: resolved.name,
              },
              resolved.orgId ?? null,
            );
          } else {
            setSentryUser(null, null);
          }
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
