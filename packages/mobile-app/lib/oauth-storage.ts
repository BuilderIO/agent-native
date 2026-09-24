// Keys shared between AppWebView (which starts Google sign-in) and the
// oauth-complete deep-link fallback. Kept in one place so the strings can't
// drift apart and silently break the state check or the return navigation.
export const OAUTH_STATE_KEY = "agent-native:oauth-state";
export const OAUTH_RETURN_PATH_KEY = "agent-native:oauth-return-path";
export const OAUTH_TOKEN_STORE_KEY = "agent-native:oauth-token-key";
// Set only for apps that also need an owner key (Clips): the AsyncStorage key
// to write the owner into, and the app origin used to resolve the owner's
// email/orgId from the session after the token is saved.
export const OAUTH_OWNER_KEY_KEY = "agent-native:oauth-owner-key";
export const OAUTH_BASE_URL_KEY = "agent-native:oauth-base-url";
