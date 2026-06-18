import type { ActionEntry } from "@agent-native/core/server";
import approveDispatchChange from "./approve-dispatch-change.js";
import approveVaultRequest from "./approve-vault-request.js";
import archiveWorkspaceApp from "./archive-workspace-app.js";
import askApp from "./ask_app.js";
import createLinkToken from "./create-link-token.js";
import createPylonTicket from "./create-pylon-ticket.js";
import createVaultGrant from "./create-vault-grant.js";
import createVaultSecret from "./create-vault-secret.js";
import createWorkspaceResourceGrant from "./create-workspace-resource-grant.js";
import createWorkspaceResource from "./create-workspace-resource.js";
import createDreamReport from "./create-dream-report.js";
import createEmbedSession from "./create_embed_session.js";
import deleteStagedDataset from "./delete-staged-dataset.js";
import deleteDestination from "./delete-destination.js";
import deleteVaultSecret from "./delete-vault-secret.js";
import deleteWorkspaceResource from "./delete-workspace-resource.js";
import denyVaultRequest from "./deny-vault-request.js";
import ensureDreamJob from "./ensure-dream-job.js";
import getAppCreationSettings from "./get-app-creation-settings.js";
import getAgentThreadDebug from "./get-agent-thread-debug.js";
import getDream from "./get-dream.js";
import getDreamSettings from "./get-dream-settings.js";
import getDispatchSettings from "./get-dispatch-settings.js";
import getVaultAccessSettings from "./get-vault-access-settings.js";
import getWorkspaceResourceEffectiveContext from "./get-workspace-resource-effective-context.js";
import getWorkspaceInfo from "./get-workspace-info.js";
import grantWorkspaceResourcesToApp from "./grant-workspace-resources-to-app.js";
import grantVaultSecretsToApp from "./grant-vault-secrets-to-app.js";
import listAgentThreadSources from "./list-agent-thread-sources.js";
import listAvailableWorkspaceTemplates from "./list-available-workspace-templates.js";
import listConnectedAgents from "./list-connected-agents.js";
import listDestinations from "./list-destinations.js";
import listDispatchApprovals from "./list-dispatch-approvals.js";
import listDispatchAudit from "./list-dispatch-audit.js";
import listDispatchOverview from "./list-dispatch-overview.js";
import listDispatchUsageMetrics from "./list-dispatch-usage-metrics.js";
import listDreamCandidates from "./list-dream-candidates.js";
import listDreams from "./list-dreams.js";
import listIntegrationsCatalog from "./list-integrations-catalog.js";
import listLinkedIdentities from "./list-linked-identities.js";
import listMcpAppAccess from "./list-mcp-app-access.js";
import listApps from "./list_apps.js";
import listStagedDatasets from "./list-staged-datasets.js";
import listVaultAudit from "./list-vault-audit.js";
import listVaultGrants from "./list-vault-grants.js";
import listVaultRequests from "./list-vault-requests.js";
import listVaultSecretOptions from "./list-vault-secret-options.js";
import listVaultSecrets from "./list-vault-secrets.js";
import listWorkspaceApps from "./list-workspace-apps.js";
import listWorkspaceResourceOptions from "./list-workspace-resource-options.js";
import listWorkspaceResourceGrants from "./list-workspace-resource-grants.js";
import listWorkspaceResourcesForApp from "./list-workspace-resources-for-app.js";
import listWorkspaceResources from "./list-workspace-resources.js";
import navigate from "./navigate.js";
import openApp from "./open_app.js";
import applyDreamProposal from "./apply-dream-proposal.js";
import previewDreamProposal from "./preview-dream-proposal.js";
import previewWorkspaceResourceChange from "./preview-workspace-resource-change.js";
import providerApiCatalog from "./provider-api-catalog.js";
import providerApiDocs from "./provider-api-docs.js";
import providerApiRegister from "./provider-api-register.js";
import providerApiRequest from "./provider-api-request.js";
import queryStagedDataset from "./query-staged-dataset.js";
import rejectDispatchChange from "./reject-dispatch-change.js";
import rejectDreamProposal from "./reject-dream-proposal.js";
import removePendingWorkspaceApp from "./remove-pending-workspace-app.js";
import requestVaultSecret from "./request-vault-secret.js";
import revokeVaultGrant from "./revoke-vault-grant.js";
import revokeWorkspaceResourceGrant from "./revoke-workspace-resource-grant.js";
import restoreStarterWorkspaceResources from "./restore-starter-workspace-resources.js";
import scaffoldWorkspaceApp from "./scaffold-workspace-app.js";
import searchAgentThreads from "./search-agent-threads.js";
import sendCodeAgentRemoteCommand from "./send-code-agent-remote-command.js";
import sendPlatformMessage from "./send-platform-message.js";
import setAppCreationSettings from "./set-app-creation-settings.js";
import setDispatchApprovalPolicy from "./set-dispatch-approval-policy.js";
import setDreamSettings from "./set-dream-settings.js";
import setMcpAppAccess from "./set-mcp-app-access.js";
import setVaultAccessSettings from "./set-vault-access-settings.js";
import startWorkspaceAppCreation from "./start-workspace-app-creation.js";
import syncVaultToApp from "./sync-vault-to-app.js";
import unarchiveWorkspaceApp from "./unarchive-workspace-app.js";
import updateWorkspaceAppMetadata from "./update-workspace-app-metadata.js";
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
  "archive-workspace-app": archiveWorkspaceApp,
  ask_app: askApp,
  "create-link-token": createLinkToken,
  "create-pylon-ticket": createPylonTicket,
  "create-vault-grant": createVaultGrant,
  "create-vault-secret": createVaultSecret,
  "create-workspace-resource-grant": createWorkspaceResourceGrant,
  "create-workspace-resource": createWorkspaceResource,
  "create-dream-report": createDreamReport,
  create_embed_session: createEmbedSession,
  "delete-staged-dataset": deleteStagedDataset,
  "delete-destination": deleteDestination,
  "delete-vault-secret": deleteVaultSecret,
  "delete-workspace-resource": deleteWorkspaceResource,
  "deny-vault-request": denyVaultRequest,
  "ensure-dream-job": ensureDreamJob,
  "get-app-creation-settings": getAppCreationSettings,
  "get-agent-thread-debug": getAgentThreadDebug,
  "get-dream": getDream,
  "get-dream-settings": getDreamSettings,
  "get-dispatch-settings": getDispatchSettings,
  "get-vault-access-settings": getVaultAccessSettings,
  "get-workspace-resource-effective-context":
    getWorkspaceResourceEffectiveContext,
  "get-workspace-info": getWorkspaceInfo,
  "grant-workspace-resources-to-app": grantWorkspaceResourcesToApp,
  "grant-vault-secrets-to-app": grantVaultSecretsToApp,
  "list-agent-thread-sources": listAgentThreadSources,
  "list-available-workspace-templates": listAvailableWorkspaceTemplates,
  "list-connected-agents": listConnectedAgents,
  "list-destinations": listDestinations,
  "list-dispatch-approvals": listDispatchApprovals,
  "list-dispatch-audit": listDispatchAudit,
  "list-dispatch-overview": listDispatchOverview,
  "list-dispatch-usage-metrics": listDispatchUsageMetrics,
  "list-dream-candidates": listDreamCandidates,
  "list-dreams": listDreams,
  "list-integrations-catalog": listIntegrationsCatalog,
  "list-linked-identities": listLinkedIdentities,
  "list-mcp-app-access": listMcpAppAccess,
  list_apps: listApps,
  "list-staged-datasets": listStagedDatasets,
  "list-vault-audit": listVaultAudit,
  "list-vault-grants": listVaultGrants,
  "list-vault-requests": listVaultRequests,
  "list-vault-secret-options": listVaultSecretOptions,
  "list-vault-secrets": listVaultSecrets,
  "list-workspace-apps": listWorkspaceApps,
  "list-workspace-resource-options": listWorkspaceResourceOptions,
  "list-workspace-resource-grants": listWorkspaceResourceGrants,
  "list-workspace-resources-for-app": listWorkspaceResourcesForApp,
  "list-workspace-resources": listWorkspaceResources,
  navigate: navigate,
  open_app: openApp,
  "apply-dream-proposal": applyDreamProposal,
  "preview-dream-proposal": previewDreamProposal,
  "preview-workspace-resource-change": previewWorkspaceResourceChange,
  "provider-api-catalog": providerApiCatalog,
  "provider-api-docs": providerApiDocs,
  "provider-api-register": providerApiRegister,
  "provider-api-request": providerApiRequest,
  "query-staged-dataset": queryStagedDataset,
  "reject-dispatch-change": rejectDispatchChange,
  "reject-dream-proposal": rejectDreamProposal,
  "remove-pending-workspace-app": removePendingWorkspaceApp,
  "request-vault-secret": requestVaultSecret,
  "revoke-vault-grant": revokeVaultGrant,
  "revoke-workspace-resource-grant": revokeWorkspaceResourceGrant,
  "restore-starter-workspace-resources": restoreStarterWorkspaceResources,
  "scaffold-workspace-app": scaffoldWorkspaceApp,
  "search-agent-threads": searchAgentThreads,
  "send-code-agent-remote-command": sendCodeAgentRemoteCommand,
  "send-platform-message": sendPlatformMessage,
  "set-app-creation-settings": setAppCreationSettings,
  "set-dispatch-approval-policy": setDispatchApprovalPolicy,
  "set-dream-settings": setDreamSettings,
  "set-mcp-app-access": setMcpAppAccess,
  "set-vault-access-settings": setVaultAccessSettings,
  "start-workspace-app-creation": startWorkspaceAppCreation,
  "sync-vault-to-app": syncVaultToApp,
  "unarchive-workspace-app": unarchiveWorkspaceApp,
  "update-workspace-app-metadata": updateWorkspaceAppMetadata,
  "update-vault-secret": updateVaultSecret,
  "update-workspace-resource": updateWorkspaceResource,
  "upsert-destination": upsertDestination,
  "view-screen": viewScreen,
};
