import { useEffect, useRef, useState } from "react";

type OrgId = string | null | undefined;

/** Wait for a pause in input, while still searching during continuous typing. */
export function useDirectorySearchQuery(orgId: OrgId, query: string): string {
  const [request, setRequest] = useState<{ orgId: OrgId; query: string }>({
    orgId,
    query: "",
  });
  const burst = useRef<{ orgId: OrgId; startedAt: number } | null>(null);
  useEffect(() => {
    if (request.orgId === orgId && request.query === query) {
      burst.current = null;
      return;
    }
    const now = Date.now();
    if (!burst.current || burst.current.orgId !== orgId)
      burst.current = { orgId, startedAt: now };
    const remaining = Math.max(0, 600 - (now - burst.current.startedAt));
    const timer = setTimeout(
      () => {
        burst.current = null;
        setRequest({ orgId, query });
      },
      Math.min(200, remaining),
    );
    return () => clearTimeout(timer);
  }, [orgId, query, request.orgId, request.query]);
  return request.orgId === orgId ? request.query : "";
}
