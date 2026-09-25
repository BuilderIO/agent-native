import { useActionQuery } from "@agent-native/core/client/hooks";

import {
  normalizeReferenceUrls,
  type DesignSystemData,
} from "../../shared/api";
import { DEFAULT_SLIDE_BACKGROUND } from "../../shared/slide-background";

const DEFAULT_DESIGN_SYSTEM: DesignSystemData = {
  colors: {
    primary: "#2457D6", // guard:allow-raw-color - default slide design-system palette
    secondary: "#C85C3A", // guard:allow-raw-color - default slide design-system palette
    accent: "#2457D6", // guard:allow-raw-color - default slide design-system palette
    background: DEFAULT_SLIDE_BACKGROUND,
    surface: "#FFFFFF", // guard:allow-raw-color - default slide design-system palette
    text: "#1F2933", // guard:allow-raw-color - default slide design-system palette
    textMuted: "#667085", // guard:allow-raw-color - default slide design-system palette
  },
  typography: {
    headingFont: "Inter",
    bodyFont: "Inter",
    headingWeight: "750",
    bodyWeight: "450",
    headingSizes: { h1: "56px", h2: "34px", h3: "24px" },
  },
  spacing: { slidePadding: "64px 80px", elementGap: "18px" },
  borders: { radius: "14px", accentWidth: "3px" },
  slideDefaults: {
    background: DEFAULT_SLIDE_BACKGROUND,
    labelStyle: "capitalize",
  },
  logos: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeWithDefaults<T>(defaults: T, value: unknown): T {
  if (Array.isArray(defaults)) {
    return (Array.isArray(value) ? value : defaults) as T;
  }

  if (isRecord(defaults)) {
    const source = isRecord(value) ? value : {};
    const merged: Record<string, unknown> = {};

    for (const [key, defaultValue] of Object.entries(defaults)) {
      merged[key] = mergeWithDefaults(defaultValue, source[key]);
    }

    for (const [key, sourceValue] of Object.entries(source)) {
      if (!(key in merged) && sourceValue !== undefined) {
        merged[key] = sourceValue;
      }
    }

    return merged as T;
  }

  // Every leaf in DEFAULT_DESIGN_SYSTEM is a string (including union-typed
  // ones like slideDefaults.labelStyle), and DesignSystemCard/slide renderers
  // call string methods (e.g. `.split()` on typography.headingFont) with no
  // type guard. A persisted value of the wrong runtime type — an empty
  // object from an interrupted generation, a stray number — must fall back
  // to the default rather than reach those call sites and crash the caller.
  if (value === undefined || value === null) return defaults;
  return (typeof value === typeof defaults ? value : defaults) as T;
}

export function getDesignSystemImageStyleReferenceUrls(
  designSystem?: Pick<DesignSystemData, "imageStyle"> | null,
): string[] {
  return normalizeReferenceUrls(designSystem?.imageStyle?.referenceUrls);
}

export function mergeDesignSystemData(value: unknown): DesignSystemData {
  return mergeWithDefaults(DEFAULT_DESIGN_SYSTEM, value);
}

export interface DeckDesignSystemResult {
  designSystem: DesignSystemData | undefined;
  designSystemTitle: string | null;
  imageStyleReferenceUrls: string[];
  isLoading: boolean;
  /** Raw JSON of the design system row, before defaults are merged in. */
  rawData: string | null;
}

// Returning a stock palette for an unlinked deck publishes `--ds-*` values the
// slide's own `var(--ds-*, ...)` fallbacks can never override, so "no design
// system" renders as one nobody picked.
export function resolveDeckDesignSystem(
  designSystemId: string | null | undefined,
  data: { title?: string | null; data?: string } | undefined,
): Omit<DeckDesignSystemResult, "isLoading"> {
  if (!designSystemId || !data?.data) {
    return {
      designSystem: undefined,
      designSystemTitle: null,
      imageStyleReferenceUrls: [],
      rawData: null,
    };
  }

  try {
    const parsed = mergeDesignSystemData(JSON.parse(data.data));
    return {
      designSystem: parsed,
      designSystemTitle: data.title ?? null,
      imageStyleReferenceUrls: getDesignSystemImageStyleReferenceUrls(parsed),
      rawData: data.data,
    };
  } catch {
    return {
      designSystem: undefined,
      designSystemTitle: data.title ?? null,
      imageStyleReferenceUrls: [],
      rawData: data.data,
    };
  }
}

export function useDeckDesignSystem(
  designSystemId?: string | null,
): DeckDesignSystemResult {
  const { data, isLoading } = useActionQuery<{
    id: string;
    title: string;
    data: string;
  }>("get-design-system", designSystemId ? { id: designSystemId } : undefined, {
    enabled: Boolean(designSystemId),
  });

  return {
    ...resolveDeckDesignSystem(designSystemId, data),
    isLoading: designSystemId ? isLoading : false,
  };
}

export { DEFAULT_DESIGN_SYSTEM };
