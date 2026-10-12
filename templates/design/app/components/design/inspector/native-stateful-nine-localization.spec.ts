import {
  STATEFUL_NINE_DEFINITIONS,
  STATEFUL_NINE_PRESETS,
} from "@shared/native-effect-owned-stateful-nine";
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
  nativeCatalogOptionKey,
  nativeCatalogPresetKey,
  nativeCatalogPropertyKey,
} from "./native-catalog-display";

const catalogs = [ar, de, en, es, fr, hi, ja, ko, pt, zh, tw];
const message = (catalog: typeof en, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined,
      catalog,
    );

describe("stateful-nine catalog localization", () => {
  it("localizes definitions, controls, and all eighteen recipes in every catalog", () => {
    const keys: string[] = [];
    for (const definition of STATEFUL_NINE_DEFINITIONS) {
      const definitionKey = nativeCatalogDefinitionKey(
        structuredClone(definition),
      );
      expect(definitionKey, definition.id).not.toBeNull();
      keys.push(definitionKey!);
      for (const property of Object.values(definition.properties)) {
        const propertyKey = nativeCatalogPropertyKey(
          definition,
          property.label,
        );
        expect(
          propertyKey,
          `${definition.id}: ${property.label}`,
        ).not.toBeNull();
        keys.push(propertyKey!);
        if (property.type === "enum")
          for (const option of property.options) {
            const optionKey = nativeCatalogOptionKey(definition, option);
            expect(optionKey, `${definition.id}: ${option}`).not.toBeNull();
            keys.push(optionKey!);
          }
      }
    }
    for (const preset of STATEFUL_NINE_PRESETS) {
      const presetKey = nativeCatalogPresetKey(structuredClone(preset));
      expect(presetKey, preset.id).not.toBeNull();
      keys.push(presetKey!);
    }
    for (const catalog of catalogs)
      for (const key of new Set(keys)) {
        const value = message(catalog, key);
        expect(typeof value, key).toBe("string");
        expect((value as string).length).toBeGreaterThan(0);
      }
  });
});
