/**
 * Shared code between client and server
 * Useful to share types between client and server
 * and/or small pure JS functions that can be used on both client and server
 */

/**
 * Example response type for /api/demo
 */
export interface DemoResponse {
  message: string;
}

// --- Design Systems ---

export interface DesignSystemData {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    headingWeight: string;
    bodyWeight: string;
    headingSizes: { h1: string; h2: string; h3: string };
  };
  spacing: { slidePadding: string; elementGap: string };
  borders: { radius: string; accentWidth: string };
  slideDefaults: {
    background: string;
    labelStyle: "uppercase" | "lowercase" | "capitalize" | "none";
  };
  logos: { url: string; name: string; variant: "light" | "dark" | "auto" }[];
  imageStyle?: {
    referenceUrls: string[];
    styleDescription: string;
  };
  customCSS?: string;
  notes?: string;
}

export interface DesignSystemAsset {
  id: string;
  name: string;
  type: "logo" | "font" | "image" | "icon";
  url: string;
  mimeType: string;
}

// --- Question Flow ---

export interface QuestionFlowQuestion {
  id: string;
  type: "text-options" | "color-options" | "slider" | "file" | "freeform";
  question: string;
  description?: string;
  options?: {
    label: string;
    value: string;
    color?: string;
    icon?: string;
  }[];
  multiSelect?: boolean;
  min?: number;
  max?: number;
  required?: boolean;
}
