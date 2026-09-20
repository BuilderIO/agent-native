import {
  BuilderConnectCard as RuntimeBuilderConnectCard,
  ProviderReadinessBadge as RuntimeProviderReadinessBadge,
  SetupConnectionsPage as RuntimeSetupConnectionsPage,
  type BuilderConnectCardProps,
  type ProviderReadinessBadgeProps,
  type SetupConnectionsPageProps,
} from "@agent-native/core/client/setup-connections/runtime";
import type { ReactElement } from "react";

export * from "@agent-native/core/client/setup-connections/runtime";

export function BuilderConnectCard(
  props: BuilderConnectCardProps,
): ReactElement {
  return <RuntimeBuilderConnectCard {...props} />;
}

export function ProviderReadinessBadge(
  props: ProviderReadinessBadgeProps,
): ReactElement {
  return <RuntimeProviderReadinessBadge {...props} />;
}

export function SetupConnectionsPage(
  props: SetupConnectionsPageProps,
): ReactElement {
  return <RuntimeSetupConnectionsPage {...props} />;
}
