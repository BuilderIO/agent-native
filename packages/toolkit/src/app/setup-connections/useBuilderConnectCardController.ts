import { useCallback } from "react";

import {
  useBuilderConnectFlow,
  type BuilderConnectFlow,
  type BuilderConnectionScope,
} from "../settings/useBuilderStatus.js";

const DEFAULT_TITLE = "Builder connect";
const DEFAULT_DESCRIPTION =
  "Connect Builder.io for managed model access, browser automation, and workspace identity. Free tier available.";
const DEFAULT_TRACKING_SOURCE = "setup_connections_page";

export interface BuilderConnectCardControllerOptions {
  title?: string;
  description?: string;
  trackingSource?: string;
  onConnected?: (orgName: string | null) => void;
  /**
   * Show and connect exactly this connection. The card is then connected only
   * while that grant is usable, and offers Connect only to callers the server
   * allows to connect it. Omit for "any Builder.io connection".
   */
  scope?: BuilderConnectionScope;
}

export type BuilderConnectCardStatus =
  | { kind: "checking"; label: "Checking" }
  | { kind: "ready"; label: "Ready to connect" }
  | { kind: "connected"; label: string };

export interface BuilderConnectCardAction {
  label: "Connect Builder.io";
  pending: boolean;
  disabled: boolean;
  onPress: (provisionAccount?: boolean) => void;
}

export interface BuilderConnectCardViewModel {
  title: string;
  description: string;
  status: BuilderConnectCardStatus;
  configured: boolean;
  pending: boolean;
  error: string | null;
  orgName: string | null;
  connectFlow?: BuilderConnectFlow;
  action: BuilderConnectCardAction | null;
  scope?: BuilderConnectionScope;
}

function isScopeConnected(
  flow: BuilderConnectFlow,
  scope: BuilderConnectionScope,
): boolean {
  const grant = flow.grants?.[scope];
  return Boolean(grant && !grant.needsReconnect);
}

export function useBuilderConnectCardController({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  trackingSource = DEFAULT_TRACKING_SOURCE,
  onConnected,
  scope,
}: BuilderConnectCardControllerOptions = {}): BuilderConnectCardViewModel {
  const handleConnected = useCallback(
    ({ orgName }: { orgName: string | null }) => onConnected?.(orgName),
    [onConnected],
  );
  const flow = useBuilderConnectFlow({
    provisionAccount: true,
    trackingSource,
    onConnected: handleConnected,
  });
  const handlePress = useCallback(
    (provisionAccount = false) =>
      flow.start(scope ? { provisionAccount, scope } : { provisionAccount }),
    [flow.start, scope],
  );

  const configured = scope ? isScopeConnected(flow, scope) : flow.configured;
  const canConnect = scope ? flow.canConnect[scope] : true;
  const status: BuilderConnectCardStatus = !flow.hasFetchedStatus
    ? { kind: "checking", label: "Checking" }
    : configured
      ? {
          kind: "connected",
          label: flow.orgName ? `Connected to ${flow.orgName}` : "Connected",
        }
      : { kind: "ready", label: "Ready to connect" };

  return {
    title,
    description,
    status,
    configured,
    pending: flow.connecting,
    error: flow.error,
    orgName: flow.orgName,
    connectFlow: flow,
    action:
      configured || !canConnect
        ? null
        : {
            label: "Connect Builder.io",
            pending: flow.connecting,
            disabled: flow.connecting,
            onPress: handlePress,
          },
    ...(scope ? { scope } : {}),
  };
}
