import messages from "../../../i18n/en-US";

/** The en-US catalog as the translation hook reads it; an unknown key comes back as the key. */
export function translate(key: string, vars?: Record<string, unknown>): string {
  let value: unknown = messages;
  for (const part of key.split(".")) {
    value =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)[part]
        : undefined;
  }
  const text = typeof value === "string" ? value : key;
  return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(vars?.[name] ?? ""),
  );
}

export const i18nMock = { useT: () => translate };
