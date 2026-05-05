import type { ActionEntry } from "@agent-native/core/server";
import approveDispatchChange from "./approve-dispatch-change.js";
import approveVaultRequest from "./approve-vault-request.js";
import createLinkToken from "./create-link-token.js";
import createVaultGrant from "./create-vault-grant.js";
import createVaultSecret from "./create-vault-secret.js";
import createWorkspaceResourceGrant from "./create-workspace-resource-grant.js";
import createWorkspaceResource from "./create-workspace-resource.js";
import deleteDestination from "./delete-destination.js";
import deleteVaultSecret from "./delete-vault-secret.js";
import deleteWorkspaceResource from "./delete-workspace-resource.js";
import denyVaultRequest from "./deny-vault-request.js";
import getAppCreationSettings from "./get-app-creation-settings.js";
import getDispatchSettings from "./get-dispatch-settings.js";
import getWorkspaceInfo from "./get-workspace-info.js";
import grantVaultSecretsToApp from "./grant-vault-secrets-to-app.js";
import listConnectedAgents from "./list-connected-agents.js";
import listDestinations from "./list-destinations.js";
import listDispatchApprovals from "./list-dispatch-approvals.js";
import listDispatchAudit from "./list-dispatch-audit.js";
import listDispatchOverview from "./list-dispatch-overview.js";
import listDispatchUsageMetrics from "./list-dispatch-usage-metrics.js";
import listIntegrationsCatalog from "./list-integrations-catalog.js";
import listLinkedIdentities from "./list-linked-identities.js";
import listVaultAudit from "./list-vault-audit.js";
import listVaultGrants from "./list-vault-grants.js";
import listVaultRequests from "./list-vault-requests.js";
import listVaultSecretOptions from "./list-vault-secret-options.js";
import listVaultSecrets from "./list-vault-secrets.js";
import listWorkspaceApps from "./list-workspace-apps.js";
import listWorkspaceResourceGrants from "./list-workspace-resource-grants.js";
import listWorkspaceResources from "./list-workspace-resources.js";
import navigate from "./navigate.js";
import rejectDispatchChange from "./reject-dispatch-change.js";
import requestVaultSecret from "./request-vault-secret.js";
import revokeVaultGrant from "./revoke-vault-grant.js";
import revokeWorkspaceResourceGrant from "./revoke-workspace-resource-grant.js";
import sendPlatformMessage from "./send-platform-message.js";
import setAppCreationSettings from "./set-app-creation-settings.js";
import setDispatchApprovalPolicy from "./set-dispatch-approval-policy.js";
import startWorkspaceAppCreation from "./start-workspace-app-creation.js";
import syncVaultToApp from "./sync-vault-to-app.js";
import syncWorkspaceResourcesToAll from "./sync-workspace-resources-to-all.js";
import syncWorkspaceResourcesToApp from "./sync-workspace-resources-to-app.js";
import updateVaultSecret from "./update-vault-secret.js";
import updateWorkspaceResource from "./update-workspace-resource.js";
import upsertDestination from "./upsert-destination.js";
import viewScreen from "./view-screen.js";

/**
 * Dispatch's actions registered as a flat name→entry map. Imported by
 * `@agent-native/dispatch/server`'s side-effect block, which calls
 * `registerPackageActions(dispatchActions)` so the framework's action
 * loader picks them up.
 */
export const dispatchActions: Record<string, ActionEntry> = {
  "approve-dispatch-change": approveDispatchChange,
  "approve-vault-request": approveVaultRequest,
  "create-link-token": createLinkToken,
  "create-vault-grant": createVaultGrant,
  "create-vault-secret": createVaultSecret,
  "create-workspace-resource-grant": createWorkspaceResourceGrant,
  "create-workspace-resource": createWorkspaceResource,
  "delete-destination": deleteDestination,
  "delete-vault-secret": deleteVaultSecret,
  "delete-workspace-resource": deleteWorkspaceResource,
  "deny-vault-request": denyVaultRequest,
  "get-app-creation-settings": getAppCreationSettings,
  "get-dispatch-settings": getDispatchSettings,
  "get-workspace-info": getWorkspaceInfo,
  "grant-vault-secrets-to-app": grantVaultSecretsToApp,
  "list-connected-agents": listConnectedAgents,
  "list-destinations": listDestinations,
  "list-dispatch-approvals": listDispatchApprovals,
  "list-dispatch-audit": listDispatchAudit,
  "list-dispatch-overview": listDispatchOverview,
  "list-dispatch-usage-metrics": listDispatchUsageMetrics,
  "list-integrations-catalog": listIntegrationsCatalog,
  "list-linked-identities": listLinkedIdentities,
  "list-vault-audit": listVaultAudit,
  "list-vault-grants": listVaultGrants,
  "list-vault-requests": listVaultRequests,
  "list-vault-secret-options": listVaultSecretOptions,
  "list-vault-secrets": listVaultSecrets,
  "list-workspace-apps": listWorkspaceApps,
  "list-workspace-resource-grants": listWorkspaceResourceGrants,
  "list-workspace-resources": listWorkspaceResources,
  navigate: navigate,
  "reject-dispatch-change": rejectDispatchChange,
  "request-vault-secret": requestVaultSecret,
  "revoke-vault-grant": revokeVaultGrant,
  "revoke-workspace-resource-grant": revokeWorkspaceResourceGrant,
  "send-platform-message": sendPlatformMessage,
  "set-app-creation-settings": setAppCreationSettings,
  "set-dispatch-approval-policy": setDispatchApprovalPolicy,
  "start-workspace-app-creation": startWorkspaceAppCreation,
  "sync-vault-to-app": syncVaultToApp,
  "sync-workspace-resources-to-all": syncWorkspaceResourcesToAll,
  "sync-workspace-resources-to-app": syncWorkspaceResourcesToApp,
  "update-vault-secret": updateVaultSecret,
  "update-workspace-resource": updateWorkspaceResource,
  "upsert-destination": upsertDestination,
  "view-screen": viewScreen,
};
