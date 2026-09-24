import {
  ActionButton,
  Skeleton,
  Status,
} from "@agent-native/toolkit/design-system";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, type ReactNode } from "react";

import type { BuilderDsiAccess } from "../shared/builder-dsi-access.js";
import { useT } from "./i18n.js";
import { buildSignInReturnHref } from "./require-session.js";
import { BuilderConnectPopover } from "./settings/BuilderConnectPopover.js";
import { useBuilderConnectFlow } from "./settings/useBuilderStatus.js";
import { callAction } from "./use-action.js";
import { useSession } from "./use-session.js";

export function BuilderDsiGate({
  children,
  onBack,
}: {
  children: ReactNode;
  onBack?: () => void;
}) {
  const t = useT();
  const { session, status: sessionStatus, retry: retrySession } = useSession();
  const access = useQuery({
    queryKey: [
      "action",
      "get-builder-dsi-access",
      session?.email,
      session?.orgId,
    ],
    queryFn: () =>
      callAction<BuilderDsiAccess>(
        "get-builder-dsi-access",
        {},
        { method: "GET" },
      ),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    enabled: sessionStatus === "authenticated",
  });
  const { refetch } = access;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);
  const flow = useBuilderConnectFlow({
    enabled:
      access.data?.status === "missing" ||
      access.data?.status === "reconnect_required",
    trackingSource: "design_system_creation",
    trackingFlow: "design_system_intelligence",
    onConnected: refresh,
  });
  useEffect(() => {
    const changed = () => {
      void refresh();
    };
    window.addEventListener("agent-engine:configured-changed", changed);
    return () =>
      window.removeEventListener("agent-engine:configured-changed", changed);
  }, [refresh]);

  const back = onBack ? (
    <ActionButton emphasis="ghost" onPress={onBack}>
      {t("agentChat.composer.contextBack")}
    </ActionButton>
  ) : null;
  if (
    sessionStatus === "loading" ||
    sessionStatus === "signing-out" ||
    (sessionStatus === "authenticated" &&
      (access.isPending || (!access.isFetchedAfterMount && access.isFetching)))
  ) {
    return (
      <div className="flex flex-col items-start gap-4 p-4">
        {back}
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (
    sessionStatus === "authenticated" &&
    !access.isError &&
    access.data?.status === "ready"
  )
    return children;

  const status =
    sessionStatus === "unauthenticated"
      ? "unauthenticated"
      : sessionStatus === "unavailable" || access.isError
        ? "unavailable"
        : access.data?.status;
  const connect = status === "missing" || status === "reconnect_required";
  return (
    <div className="flex flex-col items-start gap-4 p-4">
      {back}
      <p className="text-sm text-muted-foreground">
        {t(
          status === "unavailable" || !status
            ? "agentChat.dsi.accessUnavailable"
            : status === "unauthenticated"
              ? "agentChat.auth.requiredDescription"
              : "agentChat.dsi.connectRequired",
        )}
      </p>
      {flow.error ? <Status tone="danger">{flow.error}</Status> : null}
      {connect ? (
        <BuilderConnectPopover flow={flow}>
          <ActionButton
            intent="primary"
            disabled={flow.connecting}
            pending={flow.connecting}
          >
            {t(
              flow.connecting
                ? "agentChat.composer.connectingBuilder"
                : status === "reconnect_required"
                  ? "agentChat.recovery.reconnectBuilder"
                  : "agentChat.composer.connectBuilder",
            )}
          </ActionButton>
        </BuilderConnectPopover>
      ) : status === "unauthenticated" ? (
        <ActionButton
          intent="primary"
          onPress={() => window.location.assign(buildSignInReturnHref())}
        >
          {t("agentChat.auth.logIn")}
        </ActionButton>
      ) : (
        <ActionButton
          onPress={() => {
            if (sessionStatus === "unavailable") retrySession();
            else void refresh();
          }}
          pending={access.isFetching}
          disabled={access.isFetching}
        >
          {t("agentChat.common.retry")}
        </ActionButton>
      )}
    </div>
  );
}
