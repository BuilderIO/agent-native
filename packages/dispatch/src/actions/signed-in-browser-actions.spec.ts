import { describe, expect, it } from "vitest";

import approveDispatchChange from "./approve-dispatch-change.js";
import approveVaultRequest from "./approve-vault-request.js";
import claimWorkspaceAppOrganization from "./claim-workspace-app-organization.js";
import connectExternalAgent from "./connect-external-agent.js";
import createBrowserChatSession from "./create-browser-chat-session.js";
import createLinkToken from "./create-link-token.js";
import createVaultGrant from "./create-vault-grant.js";
import createVaultSecret from "./create-vault-secret.js";
import createWorkspaceResourceGrant from "./create-workspace-resource-grant.js";
import deleteDestination from "./delete-destination.js";
import deleteVaultSecret from "./delete-vault-secret.js";
import denyVaultRequest from "./deny-vault-request.js";
import grantVaultSecretsToApp from "./grant-vault-secrets-to-app.js";
import grantWorkspaceResourcesToApp from "./grant-workspace-resources-to-app.js";
import rejectDispatchChange from "./reject-dispatch-change.js";
import requestVaultSecret from "./request-vault-secret.js";
import revokeVaultGrant from "./revoke-vault-grant.js";
import revokeWorkspaceResourceGrant from "./revoke-workspace-resource-grant.js";
import setDispatchApprovalPolicy from "./set-dispatch-approval-policy.js";
import setMcpAppAccess from "./set-mcp-app-access.js";
import setVaultAccessSettings from "./set-vault-access-settings.js";
import updateVaultSecret from "./update-vault-secret.js";
import upsertDestination from "./upsert-destination.js";

// Vault secrets, grants, app access and linked identities change what other
// apps and agents can do as the owner, so a full-app panel hands them to a
// signed-in browser.
const actions = [
  ["create-browser-chat-session", createBrowserChatSession],
  ["set-dispatch-approval-policy", setDispatchApprovalPolicy],
  ["reject-dispatch-change", rejectDispatchChange],
  ["approve-dispatch-change", approveDispatchChange],
  ["approve-vault-request", approveVaultRequest],
  ["deny-vault-request", denyVaultRequest],
  ["create-vault-grant", createVaultGrant],
  ["create-vault-secret", createVaultSecret],
  ["update-vault-secret", updateVaultSecret],
  ["delete-vault-secret", deleteVaultSecret],
  ["grant-vault-secrets-to-app", grantVaultSecretsToApp],
  ["revoke-vault-grant", revokeVaultGrant],
  ["set-vault-access-settings", setVaultAccessSettings],
  ["request-vault-secret", requestVaultSecret],
  ["create-link-token", createLinkToken],
  ["connect-external-agent", connectExternalAgent],
  ["set-mcp-app-access", setMcpAppAccess],
  ["create-workspace-resource-grant", createWorkspaceResourceGrant],
  ["revoke-workspace-resource-grant", revokeWorkspaceResourceGrant],
  ["grant-workspace-resources-to-app", grantWorkspaceResourcesToApp],
  ["upsert-destination", upsertDestination],
  ["delete-destination", deleteDestination],
  ["claim-workspace-app-organization", claimWorkspaceAppOrganization],
] as const;

describe("actions that need a signed-in browser", () => {
  it.each(actions)("%s refuses full-app panels", (_name, action) => {
    expect(action.requiresSignedInBrowser).toBe(true);
  });
});
