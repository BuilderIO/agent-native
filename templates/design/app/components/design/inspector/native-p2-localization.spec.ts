import {
  OWNED_P2_DEFINITIONS,
  OWNED_P2_PRESETS,
} from "@shared/native-effect-owned-p2";
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

const catalogs = [ar, de, en, es, fr, hi, ja, ko, pt, zh, tw];
const message = (catalog: typeof en, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (v, p) =>
        v && typeof v === "object"
          ? (v as Record<string, unknown>)[p]
          : undefined,
      catalog,
    );

describe("P2 normal catalog display localization", () => {
  it("translates exact definitions, controls, options and four original recipes in all eleven catalogs", () => {
    const keys: string[] = [];
    for (const d of OWNED_P2_DEFINITIONS) {
      const definitionKey = nativeCatalogDefinitionKey(structuredClone(d));
      expect(definitionKey).not.toBeNull();
      keys.push(definitionKey!);
      for (const p of Object.values(d.properties)) {
        const propertyKey = nativeCatalogPropertyKey(d, p.label);
        expect(propertyKey, p.label).not.toBeNull();
        keys.push(propertyKey!);
        if (p.type === "enum")
          for (const option of p.options) {
            const optionKey = nativeCatalogOptionKey(d, option);
            expect(optionKey, option).not.toBeNull();
            keys.push(optionKey!);
          }
      }
    }
    for (const preset of OWNED_P2_PRESETS) {
      const key = nativeCatalogPresetKey(structuredClone(preset));
      expect(key).not.toBeNull();
      keys.push(key!);
    }
    for (const catalog of catalogs)
      for (const key of new Set(keys)) {
        const value = message(catalog, key);
        expect(typeof value, key).toBe("string");
        expect((value as string).length).toBeGreaterThan(0);
      }
  });
  it("does not localize altered definitions or recipe objects as builtins", () => {
    expect(
      nativeCatalogDefinitionKey({
        ...OWNED_P2_DEFINITIONS[0]!,
        name: "Authored",
      }),
    ).toBeNull();
    expect(
      nativeCatalogPresetKey({ ...OWNED_P2_PRESETS[0]!, name: "Authored" }),
    ).toBeNull();
  });
});
