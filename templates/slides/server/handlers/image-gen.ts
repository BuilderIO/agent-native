import { resolveSecret } from "@agent-native/core/server";

interface ReferenceImage {
  data: string; // base64
  mimeType: string;
}

const NON_RENDERABLE_CONTEXT_LIMIT = 700;

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#x[0-9a-f]+;/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cappedContext(label: string, value?: string): string {
  if (!value) return "";
  const text = stripHtml(value);
  if (!text) return "";
  const capped =
    text.length > NON_RENDERABLE_CONTEXT_LIMIT
      ? `${text.slice(0, NON_RENDERABLE_CONTEXT_LIMIT)}...`
      : text;
  return `\n\n${label} (topic/style context only; do not render these words): ${capped}`;
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
  const apiKey = await resolveSecret("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  const client = new GoogleGenAI({ apiKey });

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
      text: `You are a world-class visual designer creating assets in a specific visual system. Study the ${selectedRefs.length} reference images above; they define the target style. Your output must feel indistinguishable from these references.

CRITICAL STYLE RULES (extract these from the references):
- **Exact same color palette**: Match the precise dark backgrounds, accent colors, gradients, and glow effects from the references. Do NOT use different blues, purples, or color schemes.
- **Same rendering technique**: If references use flat UI mockups, create flat UI mockups. If they use 3D renders, use 3D renders. If they use screenshots, create screenshot-style images. MATCH the rendering approach exactly.
- **Same composition style**: Match the spacing, alignment, element sizing, and visual hierarchy from the references.
- **Same visual effects**: Match the exact border styles, shadow depths, corner radii, and transparency levels.
- **NO GLOW**: Do NOT add glow effects, bloom, neon, light halos, or luminous auras. Keep all lighting flat and subtle. No glowing edges, no light emanating from elements, no soft light blooms.
- **No visible text by default**: Do NOT render words, letters, UI labels, captions, specs, prompt text, or slide copy unless the user's prompt explicitly asks for exact text in the image.
- **Same level of detail**: Don't add more detail or complexity than the references show. Match their level of abstraction.

OUTPUT FORMAT: Generate ONLY the illustration/graphic itself — NOT a slide mockup. Do NOT include any slide frame, presentation border, title text overlay, or slide layout. Just the raw image asset that will be placed INTO a slide.

STYLE MATCH IS THE #1 PRIORITY. If depicting the subject conflicts with matching the style, ALWAYS choose style over subject accuracy.

Subject to depict: ${prompt}

The following context is non-renderable background for topic/style only. Do not copy or display any of this text, HTML, labels, specs, or prompt wording inside the image.${cappedContext("Current slide", context?.slideContent)}${cappedContext("Deck", context?.deckText)}`,
    });
  } else {
    contents.push({ text: prompt });
  }

  const geminiModels = [
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
    "gemini-2.5-flash-image",
  ];
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
