import {
  NATIVE_COORDINATE_RANDOM_PRESETS,
  NATIVE_COORDINATE_RANDOM_PRESET_SOURCE_IDS,
  NATIVE_EFFECT_PRESETS,
  NATIVE_PRESET_LABEL_SOURCE_IDS,
  NATIVE_V3_PRESET_LABEL_SOURCE_IDS,
} from "@shared/native-effect-presets";
import { describe, expect, it } from "vitest";

import catalog10 from "@/i18n/ar-SA";
import catalog5 from "@/i18n/de-DE";
import catalog0 from "@/i18n/en-US";
import catalog3 from "@/i18n/es-ES";
import catalog4 from "@/i18n/fr-FR";
import catalog9 from "@/i18n/hi-IN";
import catalog6 from "@/i18n/ja-JP";
import catalog7 from "@/i18n/ko-KR";
import catalog8 from "@/i18n/pt-BR";
import catalog1 from "@/i18n/zh-CN";
import catalog2 from "@/i18n/zh-TW";

import { nativeCatalogPresetKey } from "./native-catalog-display";
const catalogs = [
  ["en-US", catalog0],
  ["zh-CN", catalog1],
  ["zh-TW", catalog2],
  ["es-ES", catalog3],
  ["fr-FR", catalog4],
  ["de-DE", catalog5],
  ["ja-JP", catalog6],
  ["ko-KR", catalog7],
  ["pt-BR", catalog8],
  ["hi-IN", catalog9],
  ["ar-SA", catalog10],
] as const;

describe("coordinate noise recipe localization lineage", () => {
  it("reuses each exact current label key across all11 shipped catalogs", () => {
    expect(NATIVE_COORDINATE_RANDOM_PRESETS).toHaveLength(53);
    for (const preset of NATIVE_COORDINATE_RANDOM_PRESETS) {
      const sourceId = NATIVE_COORDINATE_RANDOM_PRESET_SOURCE_IDS[preset.id];
      const source = NATIVE_EFFECT_PRESETS.find((p) => p.id === sourceId);
      expect(source).toBeDefined();
      expect(preset.name).toBe(source!.name);
      const labelId = NATIVE_V3_PRESET_LABEL_SOURCE_IDS[sourceId] ?? sourceId;
      expect(NATIVE_PRESET_LABEL_SOURCE_IDS[preset.id]).toBe(labelId);
      expect(nativeCatalogPresetKey(structuredClone(preset))).toBe(
        `editPanel.shaders.nativeCatalog.presets.${labelId}`,
      );
      for (const [locale, catalog] of catalogs) {
        const messages = catalog.editPanel.shaders.nativeCatalog
          .presets as Record<string, string>;
        expect(typeof messages[labelId], `${locale}: ${labelId}`).toBe(
          "string",
        );
        expect(
          messages[labelId].length,
          `${locale}: ${labelId}`,
        ).toBeGreaterThan(0);
      }
      expect(
        nativeCatalogPresetKey({ ...preset, name: "Authored recipe" }),
      ).toBeNull();
    }
  });
});
