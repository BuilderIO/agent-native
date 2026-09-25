import { messagesByLocale } from "@/i18n-data";

export type DatabaseMessageKey =
  keyof (typeof messagesByLocale)["en-US"]["database"];

export function dbText(
  key: DatabaseMessageKey,
  values?: Record<string, string | number>,
): string {
  const locale =
    typeof document === "undefined" ? "en-US" : document.documentElement.lang;
  const messages =
    messagesByLocale[locale as keyof typeof messagesByLocale] ??
    messagesByLocale["en-US"];
  const text =
    messages.database[key] ?? messagesByLocale["en-US"].database[key];
  if (!values) return text;
  return Object.entries(values).reduce(
    (current, [name, value]) =>
      current.split(`{{${name}}}`).join(String(value)),
    text,
  );
}
