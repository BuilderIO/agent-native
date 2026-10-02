import { defineLab } from "./registry.js";

export const CHATGPT_SUBSCRIPTION_LAB = defineLab({
  key: "chatgpt-subscription",
  displayName: "ChatGPT plan access",
  displayNameKey: "agentChat.settingsModel.chatgptTitle",
  descriptionKey: "agentChat.settingsModel.chatgptDescription",
  keywords: "OpenAI Codex GPT Plus Pro OAuth",
});
