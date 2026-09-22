export const CHATGPT_SUBSCRIPTION_LAB_KEY = "agent.chatgpt-subscription";
export const CHATGPT_SUBSCRIPTION_ENGINE_NAME = "chatgpt-subscription";
export const CHATGPT_SUBSCRIPTION_ENDPOINT =
  "https://chatgpt.com/backend-api/codex/responses";

export const CHATGPT_SUBSCRIPTION_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex-spark",
] as const;

export const CHATGPT_SUBSCRIPTION_DEFAULT_MODEL =
  CHATGPT_SUBSCRIPTION_MODELS[0];
