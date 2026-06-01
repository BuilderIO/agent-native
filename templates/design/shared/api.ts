/**
 * Shared types between client and server for the design template.
 */

export const API_BASE = "/api";

// --- Design Systems / Brand Kits ---

// The shared, template-agnostic token model lives in
// `@agent-native/core/brand-kit` (a "Brand Kit" = design tokens + brand assets
// + custom instructions). This template narrows it with the page-oriented
// `spacing.pagePadding` and `defaults` keys it persists.
import type {
  BrandKitData,
  BrandKitDefaults,
} from "@agent-native/core/brand-kit";

export interface DesignSystemData extends BrandKitData {
  spacing: { pagePadding: string; elementGap: string };
  defaults: BrandKitDefaults;
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
  type: "color-swatch" | "color-swatches" | "segment" | "slider" | "toggle";
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
  header?: string;
  question: string;
  description?: string;
  options?: {
    label: string;
    value: string;
    color?: string;
    icon?: string;
    description?: string;
    recommended?: boolean;
  }[];
  choices?: QuestionFlowQuestion["options"];
  multiSelect?: boolean;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  placeholder?: string;
  allowOther?: boolean;
  includeExplore?: boolean;
  includeDecide?: boolean;
}
