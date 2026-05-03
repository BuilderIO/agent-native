/**
 * Shared types between client and server
 */

export interface DemoResponse {
  message: string;
}

// --- Default Style References ---

export const DEFAULT_STYLE_REFERENCE_URLS: string[] = [];

// --- Image Generation ---

export type ImageGenModel = "gemini" | "openai" | "auto";

export interface ImageGenRequest {
  prompt: string;
  model: ImageGenModel;
  size?: string;
  referenceImageUrls?: string[]; // URLs of reference images
  uploadedReferenceImages?: string[]; // base64 data URLs
}

export interface ImageGenResponse {
  url: string; // data URL of generated image
  model: string;
  prompt: string;
}

export interface ImageGenStatusResponse {
  gemini: boolean;
  openai: boolean;
  preferredProvider: string | null;
}

// --- AI Slide Generation ---

export interface SlideGenerateRequest {
  topic: string;
  slideCount?: number;
  style?: string;
  includeImages?: boolean;
  referenceImageUrls?: string[];
  uploadedReferenceImages?: string[];
}

export interface GeneratedSlide {
  content: string;
  layout: "title" | "content" | "two-column" | "image" | "blank";
  notes: string;
  background?: string;
  imagePrompt?: string; // prompt to generate an image for this slide
}

export interface SlideGenerateResponse {
  slides: GeneratedSlide[];
}

// --- Share Links ---

export interface ShareDeckRequest {
  deck: {
    id: string;
    title: string;
    slides: Array<{
      id: string;
      content: string;
      notes: string;
      layout: string;
      background?: string;
    }>;
  };
}

export interface ShareDeckResponse {
  shareToken: string;
}

export interface SharedDeckResponse {
  title: string;
  slides: Array<{
    id: string;
    content: string;
    notes: string;
    layout: string;
    background?: string;
  }>;
  aspectRatio?: import("./aspect-ratios").AspectRatio;
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
