import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerationResult,
  ReferenceImage,
} from "./types.js";

export class OpenAIProvider implements ImageProvider {
  name = "openai";

  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async generate(
    prompt: string,
    referenceImages: ReferenceImage[] = [],
    context?: { slideContent?: string; deckText?: string },
    config?: ImageProviderConfig,
  ): Promise<ImageGenerationResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    // OpenAI doesn't support reference images natively — fold style description into prompt
    const fullPrompt = buildOpenAIPrompt(prompt, referenceImages, context);

    // Map config to OpenAI parameters
    const size = mapSize(config?.aspectRatio, config?.size);
    const quality = mapQuality(config?.quality);

    const body = {
      model: "gpt-image-2",
      prompt: fullPrompt,
      n: 1,
      size,
      quality,
      output_format: config?.outputFormat || "png",
    };

    console.log(
      `[OpenAI] Generating with gpt-image-2 (size=${size}, quality=${quality})`,
    );

    const result = await fetchWithRetry(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    const json = await result.json();

    if (!result.ok) {
      const errorMsg =
        json?.error?.message || `OpenAI returned ${result.status}`;
      throw new Error(`OpenAI image generation failed: ${errorMsg}`);
    }

    const imageB64 = json.data?.[0]?.b64_json;
    if (!imageB64) {
      throw new Error("No image data returned from OpenAI");
    }

    const buffer = Buffer.from(imageB64, "base64");
    const mimeType =
      config?.outputFormat === "webp" ? "image/webp" : "image/png";

    console.log(
      `[OpenAI] Success — ${Math.round(buffer.length / 1024)}KB ${mimeType}`,
    );

    return {
      imageData: buffer,
      mimeType,
      model: "gpt-image-2",
      provider: "openai",
    };
  }

  async edit(
    imageData: Buffer,
    prompt: string,
    config?: ImageProviderConfig,
  ): Promise<ImageGenerationResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const size = mapSize(config?.aspectRatio, config?.size);
    const quality = mapQuality(config?.quality);

    // Use FormData for the edits endpoint (multipart)
    const formData = new FormData();
    formData.append(
      "image",
      new Blob([new Uint8Array(imageData)], { type: "image/png" }),
      "image.png",
    );
    formData.append("prompt", prompt);
    formData.append("model", "gpt-image-2");
    formData.append("n", "1");
    formData.append("size", size);
    formData.append("quality", quality);

    console.log(
      `[OpenAI] Editing image with gpt-image-2 (size=${size}, quality=${quality})`,
    );

    const result = await fetchWithRetry(
      "https://api.openai.com/v1/images/edits",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      },
    );

    const json = await result.json();

    if (!result.ok) {
      const errorMsg =
        json?.error?.message || `OpenAI returned ${result.status}`;
      throw new Error(`OpenAI image edit failed: ${errorMsg}`);
    }

    const imageB64 = json.data?.[0]?.b64_json;
    if (!imageB64) {
      throw new Error("No image data returned from OpenAI edit");
    }

    const buffer = Buffer.from(imageB64, "base64");

    console.log(
      `[OpenAI] Edit success — ${Math.round(buffer.length / 1024)}KB`,
    );

    return {
      imageData: buffer,
      mimeType: "image/png",
      model: "gpt-image-2",
      provider: "openai",
    };
  }
}

function mapSize(
  aspectRatio?: string,
  size?: string,
): "1024x1024" | "1536x1024" | "1024x1536" | "auto" {
  // If explicit size is provided, try to use it
  if (size) {
    const sizeMap: Record<string, "1024x1024" | "1536x1024" | "1024x1536"> = {
      square: "1024x1024",
      "1:1": "1024x1024",
      landscape: "1536x1024",
      "16:9": "1536x1024",
      portrait: "1024x1536",
      "9:16": "1024x1536",
    };
    const mapped = sizeMap[size.toLowerCase()];
    if (mapped) return mapped;
  }

  // Map aspect ratio
  if (aspectRatio) {
    if (aspectRatio === "1:1" || aspectRatio === "square") return "1024x1024";
    if (
      aspectRatio === "16:9" ||
      aspectRatio === "landscape" ||
      aspectRatio === "3:2" ||
      aspectRatio === "4:3"
    )
      return "1536x1024";
    if (
      aspectRatio === "9:16" ||
      aspectRatio === "portrait" ||
      aspectRatio === "2:3" ||
      aspectRatio === "3:4"
    )
      return "1024x1536";
  }

  // Default to landscape for slides
  return "1536x1024";
}

function mapQuality(quality?: string): "low" | "medium" | "high" {
  if (quality === "low" || quality === "medium" || quality === "high") {
    return quality;
  }
  return "medium";
}

function buildOpenAIPrompt(
  prompt: string,
  referenceImages: ReferenceImage[],
  context?: { slideContent?: string; deckText?: string },
): string {
  let fullPrompt = prompt;

  // Since OpenAI doesn't support reference images, add style guidance in text
  if (referenceImages.length > 0) {
    fullPrompt = `Create a professional, modern illustration for a presentation slide. The style should be: dark background with clean, minimal design. Use a sophisticated color palette with dark tones and subtle accent colors. No glow effects, no neon, no bloom — keep lighting flat and subtle. Match a premium tech brand aesthetic.

Subject: ${prompt}`;
  }

  if (context?.slideContent) {
    fullPrompt += `\n\nSlide content for context: ${stripHtml(context.slideContent)}`;
  }
  if (context?.deckText) {
    fullPrompt += `\n\nDeck topic: ${stripHtml(context.deckText).substring(0, 500)}`;
  }

  // Ensure output is just the image, not a slide mockup
  fullPrompt +=
    "\n\nIMPORTANT: Generate ONLY the illustration/graphic — NOT a slide mockup. No presentation borders, no title overlays.";

  return fullPrompt;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#x[0-9a-f]+;/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 3000;
      console.log(`[OpenAI] Retry ${attempt} after ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const res = await fetch(url, init);

      // Retry on rate limit
      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : (attempt + 1) * 5000;
        console.log(
          `[OpenAI] Rate limited (429), waiting ${waitMs}ms before retry`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      return res;
    } catch (e: any) {
      console.warn(`[OpenAI] Attempt ${attempt + 1} failed: ${e.message}`);
      lastError = e;
    }
  }

  throw lastError || new Error("OpenAI request failed after retries");
}
