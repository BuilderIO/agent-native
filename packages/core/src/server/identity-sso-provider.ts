/**
 * Provider id of the framework's own cross-app identity SSO link.
 *
 * It lives in its own leaf module because both `identity-sso.ts` (which writes
 * the link) and `better-auth-instance.ts` (whose promote-to-Google guard has to
 * classify it) need it, and those two already import in one direction.
 */
export const IDENTITY_SSO_PROVIDER_ID = "agent-native";
