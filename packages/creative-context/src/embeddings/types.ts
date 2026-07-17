export type EmbeddingInputPurpose = "query" | "document";

export interface EmbeddingImageInput {
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  base64: string;
}

export interface MultimodalEmbeddingInput {
  text?: string;
  images?: EmbeddingImageInput[];
}

export interface EmbeddingFamily {
  id: string;
  provider: "gemini" | "cohere" | "voyage" | (string & {});
  model: string;
  version: string;
  dimensions: number;
  supportedImageMimeTypes?: readonly EmbeddingImageInput["mimeType"][];
  embed(
    inputs: readonly MultimodalEmbeddingInput[],
    purpose: EmbeddingInputPurpose,
  ): Promise<number[][]>;
}
