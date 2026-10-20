export const CHATGPT_SUBSCRIPTION_ENGINE_NAME = "chatgpt-subscription";
export const CHATGPT_SUBSCRIPTION_RESOURCE = "https://api.openai.com/v1";
export const CHATGPT_SUBSCRIPTION_ENDPOINT = `${CHATGPT_SUBSCRIPTION_RESOURCE}/responses`;
export const CHATGPT_SUBSCRIPTION_AUTHORIZATION_ENDPOINT =
  "https://auth.openai.com/api/accounts/authorize";
export const CHATGPT_SUBSCRIPTION_TOKEN_ENDPOINT =
  "https://auth.openai.com/api/accounts/oauth/token";
export const CHATGPT_SUBSCRIPTION_ISSUER = "https://auth.openai.com";
export const CHATGPT_SUBSCRIPTION_JWKS_URI =
  "https://auth.openai.com/.well-known/jwks.json";
export const CHATGPT_SUBSCRIPTION_OIDC_CONFIGURATION_URI =
  "https://auth.openai.com/.well-known/openid-configuration";
export const CHATGPT_SUBSCRIPTION_DYNAMIC_CLIENT_ID = "dynamic_agent_client";
export const CHATGPT_SUBSCRIPTION_CALLBACK_PATH = "/auth/callback";
export const CHATGPT_SUBSCRIPTION_HOST_ID_SETTING_KEY =
  "agent.chatgpt-subscription.host-id";
export const CHATGPT_SUBSCRIPTION_ACTIVE_ACCOUNT_SETTING_KEY =
  "agent.chatgpt-subscription.active-account";
export const CHATGPT_SUBSCRIPTION_REGISTRATIONS_SETTING_KEY =
  "agent.chatgpt-subscription.registrations";
export const CHATGPT_SUBSCRIPTION_PROVIDER = "openai-codex";

export const CHATGPT_SUBSCRIPTION_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  "chatgpt.tokens.use.direct",
] as const;
