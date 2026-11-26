import type { LocaleMessages } from "@agent-native/core/client/i18n";

export function mergeMessages(
  base: LocaleMessages,
  overrides: LocaleMessages,
): LocaleMessages {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const current = merged[key];
    if (
      current &&
      value &&
      typeof current === "object" &&
      typeof value === "object" &&
      !Array.isArray(current) &&
      !Array.isArray(value)
    ) {
      merged[key] = mergeMessages(
        current as LocaleMessages,
        value as LocaleMessages,
      );
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export function normalizeMessages(value: unknown): LocaleMessages {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (Object.prototype.toString.call(value) === "[object Module]") {
    return normalizeMessages((value as { default?: unknown }).default);
  }
  return value as LocaleMessages;
}
