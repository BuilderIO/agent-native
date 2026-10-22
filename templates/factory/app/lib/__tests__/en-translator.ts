import enUS from "@/i18n/en-US";

import type { Translate } from "../typed-translate";

function lookup(key: string): string | undefined {
  let node: unknown = enUS;
  for (const part of key.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * `t` for specs: reads the en-US catalog the way i18next does (plural suffix
 * for a numeric `count`, `{{name}}` interpolation) and throws on a key the
 * catalog does not have, where the app would show a humanized key.
 */
export function createEnglishTranslator(
  requested?: Set<string>,
): Translate<string> {
  const plurals = new Intl.PluralRules("en-US");
  return (key, options) => {
    requested?.add(key);
    const count = options?.count;
    const template =
      (typeof count === "number"
        ? lookup(`${key}_${plurals.select(count)}`)
        : undefined) ?? lookup(key);
    if (template === undefined) throw new Error(`missing catalog key ${key}`);
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
      String(options?.[name] ?? ""),
    );
  };
}

/** `t` for specs that assert which key and values a pure module asked for. */
export const stubTranslator: Translate<string> = (key, options) =>
  options ? `${key} ${JSON.stringify(options)}` : key;
