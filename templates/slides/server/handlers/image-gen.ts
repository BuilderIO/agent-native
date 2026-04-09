import { DEFAULT_STYLE_REFERENCE_URLS } from "../../shared/api";

interface ReferenceImage {
  data: string; // base64
  mimeType: string;
}

/**
 * Download an image URL and convert to base64 reference image
 */
async function urlToReferenceImage(
  url: string,
): Promise<ReferenceImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = contentType.split(";")[0].trim();
    return { data: buffer.toString("base64"), mimeType };
  } catch {
    return null;
  }
}

/**
 * Parse a data URL into a reference image
 */
function dataUrlToReferenceImage(dataUrl: string): ReferenceImage | null {
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return null;
  return { data: match[2], mimeType: match[1] };
}

/**
 * Generate an image using Gemini with optional reference images for style matching
 */
export async function generateWithGemini(
  prompt: string,
  referenceImages: ReferenceImage[] = [],
  context?: { slideContent?: string; deckText?: string },
): Promise<{ imageData: Buffer; mimeType: string }> {
  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Randomly select 4 reference images for better style matching per generation
  const shuffled = [...referenceImages].sort(() => Math.random() - 0.5);
  const selectedRefs = shuffled.slice(0, 4);
  console.log(
    `[Gemini] Using ${selectedRefs.length} of ${referenceImages.length} reference images (randomly selected)`,
  );

  // Build contents with reference images + text prompt
  const contents: any[] = [];
  for (const ref of selectedRefs) {
    contents.push({
      inlineData: {
        mimeType: ref.mimeType,
        data: ref.data,
      },
    });
  }

  if (referenceImages.length > 0) {
    contents.push({
      text: `You are a world-class visual designer creating assets for Builder.io's brand. Study the ${selectedRefs.length} reference images above — they ARE the brand. Your output must be indistinguishable from these references in style.

CRITICAL STYLE RULES (extract these from the references):
- **Exact same color palette**: Match the precise dark backgrounds, accent colors, gradients, and glow effects from the references. Do NOT use different blues, purples, or color schemes.
- **Same rendering technique**: If references use flat UI mockups, create flat UI mockups. If they use 3D renders, use 3D renders. If they use screenshots, create screenshot-style images. MATCH the rendering approach exactly.
- **Same composition style**: Match the spacing, alignment, element sizing, and visual hierarchy from the references.
- **Same visual effects**: Match the exact border styles, shadow depths, corner radii, and transparency levels.
- **NO GLOW**: Do NOT add glow effects, bloom, neon, light halos, or luminous auras. Keep all lighting flat and subtle. No glowing edges, no light emanating from elements, no soft light blooms.
- **Same typography treatment**: If text appears, match the exact font weights, sizes, colors, and treatments.
- **Same level of detail**: Don't add more detail or complexity than the references show. Match their level of abstraction.

OUTPUT FORMAT: Generate ONLY the illustration/graphic itself — NOT a slide mockup. Do NOT include any slide frame, presentation border, title text overlay, or slide layout. Just the raw image asset that will be placed INTO a slide.

STYLE MATCH IS THE #1 PRIORITY. If depicting the subject conflicts with matching the style, ALWAYS choose style over subject accuracy.

Subject to depict: ${prompt}${context?.slideContent ? `\n\n**Current slide content (primary context):**\n${context.slideContent}` : ""}${context?.deckText ? `\n\n**Full deck text (secondary context for overall theme/topic):**\n${context.deckText}` : ""}`,
    });
  } else {
    contents.push({ text: prompt });
  }

  const geminiModels = ["gemini-3-pro-image-preview", "gemini-2.5-flash-image"];
  let lastError: Error | null = null;

  const isOverloadError = (e: any) =>
    e.status === 429 ||
    e.status === 503 ||
    e.message?.includes("overloaded") ||
    e.message?.includes("503") ||
    e.message?.includes("429") ||
    e.message?.includes("high demand") ||
    e.message?.includes("RESOURCE_EXHAUSTED") ||
    e.message?.includes("UNAVAILABLE");

  for (const modelName of geminiModels) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          const delay = attempt * 3000;
          console.log(
            `[Gemini] Retry ${attempt} for ${modelName} after ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
        }
        console.log(
          `[Gemini] Trying model: ${modelName} (attempt ${attempt + 1})`,
        );
        const response = await client.models.generateContent({
          model: modelName,
          contents,
          config: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        });

        const parts = response.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.inlineData) {
            const buffer = Buffer.from(part.inlineData.data!, "base64");
            console.log(
              `[Gemini] Success with ${modelName} on attempt ${attempt + 1}`,
            );
            return {
              imageData: buffer,
              mimeType: part.inlineData.mimeType || "image/png",
            };
          }
        }
        lastError = new Error(`No image returned from ${modelName}`);
        break;
      } catch (e: any) {
        console.warn(
          `[Gemini] ${modelName} attempt ${attempt + 1} failed: ${e.message}`,
        );
        lastError = e;
        if (isOverloadError(e)) continue;
        break;
      }
    }
    console.log(
      `[Gemini] All retries exhausted for ${modelName}, trying fallback...`,
    );
  }

  throw lastError || new Error("No image returned from Gemini");
}
