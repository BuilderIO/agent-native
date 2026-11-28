import { useEffect, useRef } from "react";

export type DesignReadState = "live" | "retained" | "lost" | "absent";

export interface DesignReadAccessCheck {
  status: { hasAccess: boolean; signedIn: boolean } | undefined;
  settled: boolean;
}

export function isDesignRead<T extends { files: unknown[] }>(
  read: T | string | undefined,
): read is T {
  return !!read && typeof read === "object" && Array.isArray(read.files);
}

export function resolveDesignRead<T extends { files: unknown[] }>({
  read,
  retained,
  access,
  viewerSignedIn,
}: {
  read: T | string | undefined;
  retained: T | null;
  access: DesignReadAccessCheck;
  viewerSignedIn: boolean | undefined;
}): { state: DesignReadState; metadata: T | string | undefined } {
  if (isDesignRead(read)) return { state: "live", metadata: read };
  if (!retained) return { state: "absent", metadata: read };
  const answeredForThisViewer =
    access.status?.signedIn !== false || viewerSignedIn === false;
  if (
    access.settled &&
    access.status &&
    !access.status.hasAccess &&
    answeredForThisViewer
  ) {
    return { state: "lost", metadata: read };
  }
  return { state: "retained", metadata: retained };
}

export const DESIGN_READ_RETRY_DELAYS_MS = [
  1_000, 2_000, 4_000, 8_000, 15_000,
] as const;

export function startDesignReadRecovery({
  retryRead,
  checkAccess,
  doc = document,
  win = window,
}: {
  retryRead: () => void;
  checkAccess: () => void;
  doc?: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  >;
  win?: Pick<Window, "addEventListener" | "removeEventListener">;
}): () => void {
  const isHidden = () => doc.visibilityState === "hidden";
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (isHidden()) return;
    const delay =
      DESIGN_READ_RETRY_DELAYS_MS[
        Math.min(attempt, DESIGN_READ_RETRY_DELAYS_MS.length - 1)
      ];
    timer = setTimeout(() => {
      timer = undefined;
      attempt += 1;
      retryRead();
      checkAccess();
      schedule();
    }, delay);
  };
  const retryNow = () => {
    if (isHidden()) {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      return;
    }
    attempt = 0;
    retryRead();
    checkAccess();
    schedule();
  };
  checkAccess();
  schedule();
  doc.addEventListener("visibilitychange", retryNow);
  win.addEventListener("online", retryNow);
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    doc.removeEventListener("visibilitychange", retryNow);
    win.removeEventListener("online", retryNow);
  };
}

export function useRetainedDesignRead<T extends { files: unknown[] }>({
  id,
  read,
  accessStatus,
  accessCheckedAt,
  accessCheckPending,
  accessCheckFailed,
  viewerSignedIn,
  retryRead,
  checkAccess,
}: {
  id: string | undefined;
  read: T | string | undefined;
  accessStatus: { hasAccess: boolean; signedIn: boolean } | undefined;
  accessCheckedAt: number;
  accessCheckPending: boolean;
  accessCheckFailed: boolean;
  viewerSignedIn: boolean | undefined;
  retryRead: () => void;
  checkAccess: () => void;
}): { state: DesignReadState; metadata: T | string | undefined } {
  const retainedRef = useRef<{
    id: string;
    metadata: T | null;
    accessCheckedAt: number;
  } | null>(null);
  if (id && isDesignRead(read)) {
    retainedRef.current = { id, metadata: read, accessCheckedAt };
  }
  const retained = retainedRef.current?.id === id ? retainedRef.current : null;
  const resolved: { state: DesignReadState; metadata: T | string | undefined } =
    retained && !retained.metadata && !isDesignRead(read)
      ? { state: "lost", metadata: read }
      : resolveDesignRead({
          read,
          retained: retained?.metadata ?? null,
          access: {
            status: accessStatus,
            settled:
              !accessCheckPending &&
              !accessCheckFailed &&
              retained !== null &&
              accessCheckedAt > retained.accessCheckedAt,
          },
          viewerSignedIn,
        });
  if (resolved.state === "lost" && retained) retained.metadata = null;

  const recoverRef = useRef({ retryRead, checkAccess });
  recoverRef.current = { retryRead, checkAccess };
  const retaining = resolved.state === "retained";
  useEffect(() => {
    if (!retaining) return;
    return startDesignReadRecovery({
      retryRead: () => recoverRef.current.retryRead(),
      checkAccess: () => recoverRef.current.checkAccess(),
    });
  }, [retaining, id]);

  return resolved;
}
