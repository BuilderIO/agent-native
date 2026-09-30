import { defineLab } from "./registry.js";

export const CHATGPT_SUBSCRIPTION_LAB = defineLab({
  key: "chatgpt-subscription",
  displayName: "ChatGPT subscription",
  description:
    "Try the experimental Codex engine with your ChatGPT subscription.",
  keywords: "OpenAI Codex GPT Plus Pro OAuth",
});
