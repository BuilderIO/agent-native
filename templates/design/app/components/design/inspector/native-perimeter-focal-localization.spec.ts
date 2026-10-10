import {
  NATIVE_PERIMETER_FOCAL_DEFINITIONS,
  NATIVE_PERIMETER_FOCAL_PRESETS,
} from "@shared/native-effect-perimeter-focal";
import { describe, expect, it } from "vitest";

import ar from "@/i18n/ar-SA";
import de from "@/i18n/de-DE";
import en from "@/i18n/en-US";
import es from "@/i18n/es-ES";
import fr from "@/i18n/fr-FR";
import hi from "@/i18n/hi-IN";
import ja from "@/i18n/ja-JP";
import ko from "@/i18n/ko-KR";
import pt from "@/i18n/pt-BR";
import zh from "@/i18n/zh-CN";
import tw from "@/i18n/zh-TW";

import {
  nativeCatalogDefinitionKey,
  nativeCatalogPropertyKey,
  nativeCatalogOptionKey,
  nativeCatalogPresetKey,
} from "./native-catalog-display";
const catalogs = {
  "ar-SA": ar,
  "de-DE": de,
  "en-US": en,
  "es-ES": es,
  "fr-FR": fr,
  "hi-IN": hi,
  "ja-JP": ja,
  "ko-KR": ko,
  "pt-BR": pt,
  "zh-CN": zh,
  "zh-TW": tw,
};
function message(catalog: typeof en, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined,
      catalog,
    );
}
describe("perimeter/focal normal native catalog localization", () => {
  it("localizes every exact definition, control, enum and recipe in all eleven shipped locales", () => {
    const keys: string[] = [];
    for (const d of NATIVE_PERIMETER_FOCAL_DEFINITIONS) {
      const key = nativeCatalogDefinitionKey(structuredClone(d));
      expect(key).not.toBeNull();
      keys.push(key!);
      for (const property of Object.values(d.properties)) {
        const key = nativeCatalogPropertyKey(d, property.label);
        expect(key, property.label).not.toBeNull();
        keys.push(key!);
        if (property.type === "enum")
          for (const option of property.options) {
            const key = nativeCatalogOptionKey(d, option);
            expect(key, option).not.toBeNull();
            keys.push(key!);
          }
      }
    }
    for (const recipe of NATIVE_PERIMETER_FOCAL_PRESETS) {
      const key = nativeCatalogPresetKey(structuredClone(recipe));
      expect(key, recipe.id).not.toBeNull();
      keys.push(key!);
    }
    for (const [locale, catalog] of Object.entries(catalogs))
      for (const key of new Set(keys)) {
        expect(typeof message(catalog, key), `${locale}:${key}`).toBe("string");
        expect((message(catalog, key) as string).length).toBeGreaterThan(0);
      }
  });
  it("does not relabel user-modified definitions or recipe data as registered built-ins", () => {
    expect(
      nativeCatalogDefinitionKey({
        ...NATIVE_PERIMETER_FOCAL_DEFINITIONS[0],
        name: "Authored field",
      }),
    ).toBeNull();
    expect(
      nativeCatalogPresetKey({
        ...NATIVE_PERIMETER_FOCAL_PRESETS[0],
        name: "Authored recipe",
      }),
    ).toBeNull();
  });
});
