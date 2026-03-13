/**
 * Shared types between client and server
 */

export interface DemoResponse {
  message: string;
}

// --- Default Style References ---

export const DEFAULT_STYLE_REFERENCE_URLS = [
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F316cb1fd488249069477dc234092f9d2?format=webp&width=800&height=1200",
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fd273e90ea8414158ba30bb9800956244?format=webp&width=800&height=1200",
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F177545e5bf10405aa2d36e94cbdcec14?format=webp&width=800&height=1200",
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fb9b6ebd71c0b4854a925b659eafc17c6?format=webp&width=800&height=1200",
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F280ea3201b234cdf9408038f95c82145?format=webp&width=800&height=1200",
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Fa5294bbcb5b848029db6294600a7f14f?format=webp&width=800&height=1200",
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F7cd5efb949424ae2a83c68aaf159e848?format=webp&width=800&height=1200",
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F5b0a40f909b749fa90c36b323c535f81?format=webp&width=800&height=1200",
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2Faadcd3f216e444249769e0853994a2ef?format=webp&width=800&height=1200",
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F3fc375a2cdbd4788a23efef060008821?format=webp&width=800&height=1200",
];

// --- Image Generation ---

export type ImageGenModel = "gemini";

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
}
