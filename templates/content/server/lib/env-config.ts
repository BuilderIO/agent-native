import type { EnvKeyConfig } from "@agent-native/core/server";

export const envKeys: EnvKeyConfig[] = [
  { key: "NOTION_API_KEY", label: "Notion", required: false },
  { key: "GEMINI_API_KEY", label: "Gemini AI", required: false },
  { key: "OPENAI_API_KEY", label: "OpenAI", required: false },
];
