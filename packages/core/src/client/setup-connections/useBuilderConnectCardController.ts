import { useCallback } from "react";

import { useBuilderConnectFlow } from "../settings/useBuilderStatus.js";

const DEFAULT_TITLE = "Builder connect";
const DEFAULT_DESCRIPTION =
  "Connect Builder for managed model access, browser automation, and workspace identity.";
const DEFAULT_TRACKING_SOURCE = "setup_connections_page";

export interface BuilderConnectCardControllerOptions {
  title?: string;
  description?: string;
  trackingSource?: string;
  onConnected?: (orgName: string | null) => void;
}

export type BuilderConnectCardStatus =
  | { kind: "checking"; label: "Checking" }
  | { kind: "ready"; label: "Ready to connect" }
  | { kind: "connected"; label: string };

export interface BuilderConnectCardAction {
  label: "Connect Builder";
  pending: boolean;
  disabled: boolean;
  onPress: () => void;
}

export interface BuilderConnectCardViewModel {
  title: string;
  description: string;
  status: BuilderConnectCardStatus;
  configured: boolean;
  pending: boolean;
  error: string | null;
  orgName: string | null;
  action: BuilderConnectCardAction | null;
}

export function useBuilderConnectCardController({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  trackingSource = DEFAULT_TRACKING_SOURCE,
  onConnected,
}: BuilderConnectCardControllerOptions = {}): BuilderConnectCardViewModel {
  const handleConnected = useCallback(
    ({ orgName }: { orgName: string | null }) => onConnected?.(orgName),
    [onConnected],
  );
  const flow = useBuilderConnectFlow({
    trackingSource,
    onConnected: handleConnected,
  });
  const handlePress = useCallback(() => flow.start(), [flow.start]);

  const status: BuilderConnectCardStatus = !flow.hasFetchedStatus
    ? { kind: "checking", label: "Checking" }
    : flow.configured
      ? {
          kind: "connected",
          label: flow.orgName ? `Connected to ${flow.orgName}` : "Connected",
        }
      : { kind: "ready", label: "Ready to connect" };

  return {
    title,
    description,
    status,
    configured: flow.configured,
    pending: flow.connecting,
    error: flow.error,
    orgName: flow.orgName,
    action: flow.configured
      ? null
      : {
          label: "Connect Builder",
          pending: flow.connecting,
          disabled: flow.connecting,
          onPress: handlePress,
        },
  };
}
