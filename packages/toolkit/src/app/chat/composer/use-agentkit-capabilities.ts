import type { AgentKitCapabilityCatalog } from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import { agentNativeApiDisabledReason } from "@agent-native/core/client/api-surface";
import { addMcpConnectionCompleteListener } from "@agent-native/core/client/resources/mcp-connection-resume";
import {
  callAction,
  defaultActionQueryRetry,
  defaultActionQueryRetryDelay,
} from "@agent-native/core/client/use-action";
import { useSession } from "@agent-native/core/client/use-session";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";

export function agentKitCapabilityQueryKey(
  appPath: string,
  session: { email: string; orgId?: string; authUserId?: string } | null,
) {
  return [
    "action",
    "get-agentkit-capabilities",
    appPath,
    session?.email.trim().toLowerCase() ?? null,
    session?.orgId ?? null,
    session?.authUserId ?? null,
  ] as const;
}

export function useAgentKitCapabilities(options: { enabled?: boolean } = {}) {
  const { session, status, error: sessionError } = useSession();
  const queryClient = useQueryClient();
  const authorized =
    status === "authenticated" &&
    Boolean(session?.email.trim()) &&
    !agentNativeApiDisabledReason();
  const queryKey = agentKitCapabilityQueryKey(
    agentNativePath("/_agent-native/actions/get-agentkit-capabilities"),
    authorized ? session : null,
  );
  const scopeKey = JSON.stringify(queryKey);
  const scope = useMemo(() => ({ key: scopeKey }), [scopeKey]);
  const activeScope = useRef<typeof scope | null>(scope);
  activeScope.current = scope;
  useEffect(() => {
    activeScope.current = scope;
    return () => {
      activeScope.current = null;
    };
  }, [scope]);

  const capabilityQuery = useQuery<AgentKitCapabilityCatalog>({
    queryKey,
    queryFn: ({ signal }) =>
      callAction<AgentKitCapabilityCatalog>(
        "get-agentkit-capabilities",
        undefined,
        { method: "GET", signal },
      ),
    enabled: authorized && options.enabled !== false,
    staleTime: 15_000,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    retry: defaultActionQueryRetry,
    retryDelay: defaultActionQueryRetryDelay,
  });

  useEffect(() => {
    if (!authorized) return;
    const invalidate = () => {
      void queryClient.invalidateQueries({
        queryKey: ["action", "get-agentkit-capabilities"],
      });
    };
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === "updated" &&
        event.query.queryKey[0] === "mcp-servers" &&
        (event.action.type === "invalidate" || event.action.type === "success")
      ) {
        invalidate();
      }
    });
    const removeCompleteListener = addMcpConnectionCompleteListener(invalidate);
    return () => {
      unsubscribe();
      removeCompleteListener();
    };
  }, [authorized, queryClient]);

  const { refetch: refetchCapabilities } = capabilityQuery;
  const refetchIntegrations = useCallback(async () => {
    const assertCurrent = () => {
      if (!authorized || activeScope.current !== scope) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
    };
    assertCurrent();
    const result = await refetchCapabilities({ throwOnError: true });
    assertCurrent();
    return result;
  }, [authorized, scope, refetchCapabilities]);

  return {
    ...capabilityQuery,
    data:
      authorized && !capabilityQuery.isError ? capabilityQuery.data : undefined,
    integrationsLoading:
      options.enabled !== false &&
      (status === "loading" || (authorized && capabilityQuery.isPending)),
    integrationsError: sessionError ?? capabilityQuery.error,
    scopeKey,
    refetchIntegrations,
  };
}
