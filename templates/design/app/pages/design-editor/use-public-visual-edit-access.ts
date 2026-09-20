import { callAction } from "@agent-native/core/client/hooks";
import { useEffect, useRef, useState } from "react";

interface PublicVisualEditAccessArgs {
  canEditDesign: boolean;
  designQueryFailed: boolean;
  designResultReady: boolean;
  id: string | undefined;
  isVisualEditSurface: boolean;
  sessionResolved: boolean;
  shellMode: boolean;
}

/**
 * Public localhost visual-edit links get a short-lived editor capability in
 * the browser. This keeps the share surface read-only while making the
 * `/visual-edit` command usable in a signed-out browser, including Incognito.
 */
export function usePublicVisualEditAccess({
  canEditDesign,
  designQueryFailed,
  designResultReady,
  id,
  isVisualEditSurface,
  sessionResolved,
  shellMode,
}: PublicVisualEditAccessArgs): boolean {
  const accessAttemptRef = useRef<string | null>(null);
  const canEditRef = useRef<boolean | null>(null);
  const requestRef = useRef(0);
  const retryCountRef = useRef(0);
  const [retryTick, setRetryTick] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const previousCanEdit = canEditRef.current;
    canEditRef.current = canEditDesign;
    let active = true;
    let retryTimeout: number | undefined;

    if (
      !isVisualEditSurface ||
      !id ||
      !sessionResolved ||
      shellMode ||
      (!designResultReady && !designQueryFailed)
    ) {
      return () => {
        active = false;
      };
    }
    if (designQueryFailed && !designResultReady) {
      accessAttemptRef.current = null;
      setFailed(true);
      return () => {
        active = false;
      };
    }
    if (canEditDesign) {
      accessAttemptRef.current = null;
      retryCountRef.current = 0;
      setFailed(false);
      requestRef.current += 1;
      return () => {
        active = false;
      };
    }
    if (previousCanEdit === false && accessAttemptRef.current !== null) {
      return () => {
        active = false;
      };
    }

    accessAttemptRef.current = id;
    const requestId = ++requestRef.current;
    setFailed(false);
    void callAction<{ startUrl?: string }>("issue-public-visual-edit-access", {
      designId: id,
    })
      .then((result) => {
        if (!active || requestRef.current !== requestId) return;
        if (!result?.startUrl) {
          throw new Error("Visual-edit access did not return a start URL.");
        }
        window.location.replace(
          new URL(result.startUrl, window.location.href).toString(),
        );
      })
      .catch(() => {
        if (
          !active ||
          requestRef.current !== requestId ||
          accessAttemptRef.current !== id
        ) {
          return;
        }
        accessAttemptRef.current = null;
        setFailed(true);
        if (retryCountRef.current < 1) {
          retryCountRef.current += 1;
          retryTimeout = window.setTimeout(() => {
            if (
              active &&
              requestRef.current === requestId &&
              accessAttemptRef.current === null
            ) {
              setRetryTick((tick) => tick + 1);
            }
          }, 1000);
        }
      });
    return () => {
      active = false;
      if (retryTimeout !== undefined) window.clearTimeout(retryTimeout);
      if (requestRef.current === requestId) {
        requestRef.current += 1;
        if (accessAttemptRef.current === id) accessAttemptRef.current = null;
      }
    };
  }, [
    canEditDesign,
    designQueryFailed,
    designResultReady,
    id,
    isVisualEditSurface,
    retryTick,
    sessionResolved,
    shellMode,
  ]);

  return isVisualEditSurface && failed;
}
