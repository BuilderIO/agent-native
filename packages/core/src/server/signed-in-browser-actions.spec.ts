import { describe, expect, it } from "vitest";

import manageBuilderConnection from "../agent/actions/manage-builder-connection.js";
import manageProviderKeyPolicy from "../agent/actions/manage-provider-key-policy.js";
import manageServiceProviders from "../agent/actions/manage-service-providers.js";
import selectChatgptSubscriptionAccount from "../agent/actions/select-chatgpt-subscription-account.js";
import setFeatureFlag from "../feature-flags/actions/set-feature-flag.js";
import manageFileStorage from "../file-upload/actions/manage-file-storage.js";
import confirmMessagingChannelCredentialRemoval from "../integrations/actions/confirm-messaging-channel-credential-removal.js";
import manageMessagingChannel from "../integrations/actions/manage-messaging-channel.js";
import prepareMessagingChannelCredentialRemoval from "../integrations/actions/prepare-messaging-channel-credential-removal.js";
import createOrgServiceToken from "../mcp/actions/create-org-service-token.js";
import revokeOrgServiceToken from "../mcp/actions/revoke-org-service-token.js";
import setServicePrincipalLifecycle from "../mcp/actions/set-service-principal-lifecycle.js";
import setServicePrincipalPolicy from "../mcp/actions/set-service-principal-policy.js";
import inviteOrganizationMember from "../org/actions/invite-organization-member.js";
import offboardMember from "../org/actions/offboard-member.js";
import setAppMemberRoles from "../org/actions/set-app-member-roles.js";
import setAppPermissionRoles from "../org/actions/set-app-permission-roles.js";
import setWorkspaceAppAccess from "../org/actions/set-workspace-app-access.js";
import { createCustomProviderRegistrationAction } from "../provider-api/actions/custom-provider-registration.js";
import deleteApiKey from "../secrets/actions/delete-api-key.js";
import changePassword from "../user-profile/actions/change-password.js";
import setPassword from "../user-profile/actions/set-password.js";
import bulkUpdateWorkspaceUserGroups from "../workspace-connections/actions/bulk-update-workspace-user-groups.js";
import deleteWorkspaceUserGroup from "../workspace-connections/actions/delete-workspace-user-group.js";
import upsertWorkspaceUserGroup from "../workspace-connections/actions/upsert-workspace-user-group.js";

// Each of these changes who can act for the account, so a full-app panel
// must hand them to a signed-in browser.
const actions = [
  ["manage-builder-connection", manageBuilderConnection],
  ["manage-provider-key-policy", manageProviderKeyPolicy],
  ["manage-service-providers", manageServiceProviders],
  ["set-feature-flag", setFeatureFlag],
  ["manage-file-storage", manageFileStorage],
  [
    "confirm-messaging-channel-credential-removal",
    confirmMessagingChannelCredentialRemoval,
  ],
  ["manage-messaging-channel", manageMessagingChannel],
  [
    "prepare-messaging-channel-credential-removal",
    prepareMessagingChannelCredentialRemoval,
  ],
  ["create-org-service-token", createOrgServiceToken],
  ["revoke-org-service-token", revokeOrgServiceToken],
  ["set-service-principal-lifecycle", setServicePrincipalLifecycle],
  ["set-service-principal-policy", setServicePrincipalPolicy],
  ["invite-organization-member", inviteOrganizationMember],
  ["offboard-member", offboardMember],
  ["set-app-member-roles", setAppMemberRoles],
  ["set-app-permission-roles", setAppPermissionRoles],
  ["set-workspace-app-access", setWorkspaceAppAccess],
  ["delete-api-key", deleteApiKey],
  ["change-password", changePassword],
  ["set-password", setPassword],
  ["bulk-update-workspace-user-groups", bulkUpdateWorkspaceUserGroups],
  ["delete-workspace-user-group", deleteWorkspaceUserGroup],
  ["upsert-workspace-user-group", upsertWorkspaceUserGroup],
  ["select-chatgpt-subscription-account", selectChatgptSubscriptionAccount],
  ["custom-provider-registration", createCustomProviderRegistrationAction()],
] as const;

describe("actions that need a signed-in browser", () => {
  it.each(actions)("%s refuses full-app panels", (_name, action) => {
    expect(action.requiresSignedInBrowser).toBe(true);
  });
});
