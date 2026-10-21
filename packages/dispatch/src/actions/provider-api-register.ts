import { createCustomProviderRegistrationAction } from "@agent-native/core/provider-api/actions/custom-provider-registration";
import {
  getCredentialContext,
  readOrgMemberRole,
} from "@agent-native/core/server";

async function resolveCallerOrgRole(
  orgId: string,
  email: string,
): Promise<string | null> {
  try {
    return await readOrgMemberRole(orgId, email);
  } catch {
    return null;
  }
}

export default createCustomProviderRegistrationAction({
  description: `Register or update a custom API provider so the agent can call it via provider-api-request and look up its docs via provider-api-docs.

IMPORTANT — credentials:
- This action stores only credential KEY NAMES, never secret values.
- If the required API key is not yet saved, instruct the user to add it via app Settings → Keys, or use the create-vault-secret action, before calling this action.
- Supported auth kinds: none, bearer, basic, api-key-header.
  google-service-account and oauth-bearer are NOT supported for custom providers.

After registration the provider appears in provider-api-catalog and can be used with provider-api-request.`,
  getContext: getCredentialContext,
  resolveOrgRole: resolveCallerOrgRole,
});
