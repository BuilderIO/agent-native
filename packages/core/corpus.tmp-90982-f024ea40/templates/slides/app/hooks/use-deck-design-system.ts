import { useActionQuery } from "@agent-native/core/client";

import type { DesignSystemData } from "../../shared/api";

const DEFAULT_DESIGN_SYSTEM: DesignSystemData = {
  colors: {
    primary: "#609FF8",
    secondary: "#4ADE80",
    accent: "#00E5FF",
    background: "#000000",
    surface: "#0a0a0a",
    text: "#ffffff",
    textMuted: "rgba(255,255,255,0.55)",
  },
  typography: {
    headingFont: "Poppins",
    bodyFont: "Poppins",
    headingWeight: "900",
    bodyWeight: "400",
    headingSizes: { h1: "64px", h2: "40px", h3: "28px" },
  },
  spacing: { slidePadding: "80px 110px", elementGap: "20px" },
  borders: { radius: "12px", accentWidth: "4px" },
  slideDefaults: { background: "#000000", labelStyle: "uppercase" },
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

  return (value === undefined || value === null ? defaults : value) as T;
}

export function mergeDesignSystemData(value: unknown): DesignSystemData {
  return mergeWithDefaults(DEFAULT_DESIGN_SYSTEM, value);
}

export function useDeckDesignSystem(designSystemId?: string | null) {
  const { data, isLoading } = useActionQuery<{
    id: string;
    title: string;
    data: string;
  }>("get-design-system", designSystemId ? { id: designSystemId } : undefined, {
    enabled: Boolean(designSystemId),
  });

  if (!designSystemId || !data?.data) {
    return {
      designSystem: DEFAULT_DESIGN_SYSTEM,
      designSystemTitle: null,
      isLoading: false,
    };
  }

  try {
    const parsed = mergeDesignSystemData(JSON.parse(data.data));
    return {
      designSystem: parsed,
      designSystemTitle: data.title ?? null,
      isLoading,
    };
  } catch {
    return {
      designSystem: DEFAULT_DESIGN_SYSTEM,
      designSystemTitle: data.title ?? null,
      isLoading,
    };
  }
}

export { DEFAULT_DESIGN_SYSTEM };
