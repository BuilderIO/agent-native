/**
 * Shared types between client and server for the design template.
 */

export const API_BASE = "/api";

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
  spacing: { pagePadding: string; elementGap: string };
  borders: { radius: string; accentWidth: string };
  defaults: {
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

// --- Design Projects ---

export interface DesignProject {
  id: string;
  title: string;
  description?: string;
  projectType: "prototype" | "other";
  designSystemId?: string;
  files: DesignFile[];
  tweaks?: TweakDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface DesignFile {
  id: string;
  designId: string;
  filename: string;
  content: string;
  fileType: "html" | "css" | "jsx" | "asset";
}

// --- Tweaks ---

export interface TweakDefinition {
  id: string;
  label: string;
  type: "color-swatch" | "segment" | "slider" | "toggle";
  options?: { label: string; value: string; color?: string }[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue: string | number | boolean;
  cssVar?: string;
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
