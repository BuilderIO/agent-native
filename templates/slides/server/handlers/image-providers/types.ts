export interface ImageProviderConfig {
  aspectRatio?: string;
  size?: string;
  quality?: string;
  outputFormat?: string;
}

export interface ImageGenerationResult {
  imageData: Buffer;
  mimeType: string;
  model: string;
  provider: string;
}

export interface ReferenceImage {
  data: string;
  mimeType: string;
}

export interface ImageProvider {
  name: string;
  isConfigured(): boolean;
  generate(
    prompt: string,
    referenceImages?: ReferenceImage[],
    context?: { slideContent?: string; deckText?: string },
    config?: ImageProviderConfig,
  ): Promise<ImageGenerationResult>;
  edit?(
    imageData: Buffer,
    prompt: string,
    config?: ImageProviderConfig,
  ): Promise<ImageGenerationResult>;
}
