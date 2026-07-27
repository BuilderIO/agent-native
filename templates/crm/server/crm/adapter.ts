import type { CrmAccessScope, CrmAdapter } from "../../shared/crm-contract.js";
import { createHubSpotCrmAdapter } from "./hubspot-adapter.js";
import { createSalesforceCrmAdapter } from "./salesforce-adapter.js";

export const CONNECTED_CRM_PROVIDERS = ["hubspot", "salesforce"] as const;
export type ConnectedCrmProvider = (typeof CONNECTED_CRM_PROVIDERS)[number];

export type ConnectedCrmAdapter = CrmAdapter & {
  getAccessScope(objectType: string): CrmAccessScope | Promise<CrmAccessScope>;
};

export async function createConnectedCrmAdapter(options: {
  provider: ConnectedCrmProvider;
  connectionId?: string;
  userEmail?: string;
  orgId?: string | null;
}): Promise<ConnectedCrmAdapter> {
  const factoryOptions = {
    ...(options.connectionId ? { connectionId: options.connectionId } : {}),
    ...(options.userEmail ? { userEmail: options.userEmail } : {}),
    ...(options.orgId !== undefined ? { orgId: options.orgId } : {}),
  };
  return options.provider === "hubspot"
    ? createHubSpotCrmAdapter(factoryOptions)
    : createSalesforceCrmAdapter(factoryOptions);
}

export function isConnectedCrmProvider(
  provider: string,
): provider is ConnectedCrmProvider {
  return (CONNECTED_CRM_PROVIDERS as readonly string[]).includes(provider);
}
