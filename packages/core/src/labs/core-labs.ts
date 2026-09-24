import { CHATGPT_SUBSCRIPTION_LAB_KEY } from "../agent/chatgpt-subscription-contract.js";
import { defineLab } from "./registry.js";

export const CHATGPT_SUBSCRIPTION_LAB = defineLab({
  key: CHATGPT_SUBSCRIPTION_LAB_KEY,
  displayName: "ChatGPT subscription",
  description:
    "Try the experimental Codex engine with your ChatGPT subscription.",
  keywords: "OpenAI Codex GPT Plus Pro OAuth",
});
