// Brand configuration
export interface BrandConfig {
  name: string;
  description: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
}

// Agent-generated style analysis
export interface StyleProfile {
  analyzedAt: string;
  referenceCount: number;
  styleDescription: string;
  attributes: {
    colorPalette: string;
    texture: string;
    mood: string;
    composition: string;
    lighting: string;
  };
}

// Single generated image output
export interface GenerationOutput {
  filename: string;
  path: string;
}

// A generation record (prompt + all variations)
export interface GenerationRecord {
  id: string;
  prompt: string;
  variationCount: number;
  model: string;
  referenceImages: string[];
  styleProfileUsed: boolean;
  createdAt: string;
  outputs: GenerationOutput[];
}

// Generation settings
export interface GenerationSettings {
  defaultModel: string;
  defaultVariations: number;
}

// Asset categories
export type AssetCategory = "logos" | "references";

// Asset info returned by API
export interface AssetInfo {
  filename: string;
  category: AssetCategory;
  url: string;
  size: number;
  modifiedAt: number;
}

// API request/response types
export interface GenerateRequest {
  prompt: string;
  variations?: number;
  model?: string;
  referenceImages?: string[];
}

export interface UploadResponse {
  filename: string;
  category: AssetCategory;
  url: string;
}
