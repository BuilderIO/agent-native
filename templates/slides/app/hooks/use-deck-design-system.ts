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

export function useDeckDesignSystem(designSystemId?: string | null) {
  const { data, isLoading } = useActionQuery<{
    id: string;
    title: string;
    data: string;
  }>("get-design-system", designSystemId ? { id: designSystemId } : undefined, {
    enabled: Boolean(designSystemId),
  });

  if (!designSystemId || !data?.data) {
    return { designSystem: DEFAULT_DESIGN_SYSTEM, isLoading: false };
  }

  try {
    const parsed = JSON.parse(data.data) as DesignSystemData;
    return { designSystem: parsed, isLoading };
  } catch {
    return { designSystem: DEFAULT_DESIGN_SYSTEM, isLoading };
  }
}

export { DEFAULT_DESIGN_SYSTEM };
