export const QUICK_PROMPT_ACCELERATOR = "CommandOrControl+Space";

export interface QuickPromptPreferences {
  enabled: boolean;
}

export interface QuickPromptSettings extends QuickPromptPreferences {
  accelerator: string;
  registered: boolean;
  error?: string;
}

export function normalizeQuickPromptPreferences(
  value: unknown,
): QuickPromptPreferences {
  return {
    enabled:
      typeof value === "object" &&
      value !== null &&
      (value as { enabled?: unknown }).enabled === true,
  };
}
