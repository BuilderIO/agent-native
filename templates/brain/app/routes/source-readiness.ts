import type { BrainConnectionProvider } from "../lib/brain";

type ReadinessProvider = Pick<
  BrainConnectionProvider,
  "usesBrainLocalCredentials" | "providerHealth"
> & {
  workspaceConnection?: Pick<
    NonNullable<BrainConnectionProvider["workspaceConnection"]>,
    "hasActiveWorkspaceConnection"
  >;
};

export function activeConnectionMasksLocalCredentialFailure(
  provider: ReadinessProvider,
) {
  return (
    provider.workspaceConnection?.hasActiveWorkspaceConnection === true &&
    provider.usesBrainLocalCredentials === true &&
    provider.providerHealth?.status === "missing_credentials"
  );
}
