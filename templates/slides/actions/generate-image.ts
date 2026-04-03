/**
 * Generate images using Gemini with reference images for style matching.
 *
 * Usage:
 *   pnpm action generate-image --prompt "description"
 *   pnpm action generate-image --prompt "description" --slide-content "<div>...</div>"
 *   pnpm action generate-image --prompt "description" --deck-id "vkkvhkbJ_Q" --slide-id "sko-21"
 *   pnpm action generate-image --prompt "description" --count 3 --output public/assets/generated/img
 *
 * Options:
 *   --prompt              Image description (required)
 *   --slide-content       HTML content of the current slide (primary context)
 *   --deck-id             Deck ID to load full deck text as secondary context
 *   --slide-id            Slide ID within the deck (used with --deck-id to highlight current slide)
 *   --reference-image-urls  Comma-separated URLs of extra reference images
 *   --count               Number of variations to generate (default: 1)
 *   --output              Output file path prefix (e.g. public/assets/generated/slide21)
 *                         Files will be named {prefix}-v1.png, {prefix}-v2.png, etc.
 *   --help                Show this help
 */

const config = async () => {
  try {
    const m = await import("dotenv");
    m.config();
  } catch {}
};
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { DEFAULT_STYLE_REFERENCE_URLS } from "../shared/api.js";

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

/** Strip HTML tags to extract plain text from slide content */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#x[0-9a-f]+;/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Load a deck JSON and extract text context */
function loadDeckContext(
  deckId: string,
  slideId?: string,
): { slideContent?: string; deckText: string } {
  // Try to find the deck file
  const deckPath = join("data", "decks", `${deckId}.json`);
  try {
    const raw = readFileSync(deckPath, "utf-8");
    const deck = JSON.parse(raw);
    const slides = deck.slides || [];

    let slideContent: string | undefined;
    const textParts: string[] = [`Deck: ${deck.title || deckId}`];

    for (const slide of slides) {
      const text = stripHtml(slide.content || "");
      const isCurrent = slideId && slide.id === slideId;
      if (isCurrent) {
        slideContent = slide.content;
        textParts.push(`[CURRENT SLIDE ${slide.id}]: ${text}`);
      } else {
        textParts.push(`Slide ${slide.id}: ${text}`);
      }
    }

    return {
      slideContent,
      deckText: textParts.join("\n"),
    };
  } catch (err: any) {
    console.warn(`Could not load deck ${deckId}: ${err.message}`);
    return { deckText: "" };
  }
}

export default async function main(args: string[]) {
  await config();

  const opts = parseArgs(args);

  if (opts["help"]) {
    console.log(`Usage: pnpm action generate-image --prompt "description" [options]

Options:
  --prompt                Image description (required)
  --slide-content         HTML content of the current slide (primary context)
  --deck-id               Deck ID to load full deck text as secondary context
  --slide-id              Slide ID within the deck (highlights current slide)
  --reference-image-urls  Comma-separated URLs of extra reference images
  --count                 Number of variations (default: 1)
  --output                Output file path prefix (files: {prefix}-v1.png, etc.)
  --help                  Show this help`);
    return;
  }

  const prompt = opts["prompt"];
  if (!prompt) {
    console.error("Error: --prompt is required");
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("Error: GEMINI_API_KEY environment variable not set");
    process.exit(1);
  }

  const count = parseInt(opts["count"] || "1", 10);
  const outputPrefix = opts["output"];
  const extraReferenceUrls = opts["reference-image-urls"]
    ? opts["reference-image-urls"].split(",").map((u) => u.trim())
    : [];

  // Build context from slide content and/or deck
  let slideContent = opts["slide-content"];
  let deckText = "";

  if (opts["deck-id"]) {
    const deckCtx = loadDeckContext(opts["deck-id"], opts["slide-id"]);
    if (!slideContent && deckCtx.slideContent) {
      slideContent = deckCtx.slideContent;
    }
    deckText = deckCtx.deckText;
    console.log(`Loaded deck context: ${deckCtx.deckText.length} chars`);
  }

  const context =
    slideContent || deckText ? { slideContent, deckText } : undefined;

  // Always include default style references + any extra ones
  const referenceUrls = [
    ...DEFAULT_STYLE_REFERENCE_URLS,
    ...extraReferenceUrls,
  ];

  // Dynamically import the server generation function
  const { generateWithGemini } = await import("../server/routes/image-gen.js");

  // Load reference images from URLs
  const refImages: Array<{ data: string; mimeType: string }> = [];
  for (const url of referenceUrls) {
    try {
      console.log(`Loading reference image: ${url}`);
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`Failed to load reference image: ${url}`);
        continue;
      }
      const contentType = res.headers.get("content-type") || "image/png";
      const buffer = Buffer.from(await res.arrayBuffer());
      refImages.push({
        data: buffer.toString("base64"),
        mimeType: contentType.split(";")[0].trim(),
      });
    } catch (err: any) {
      console.warn(`Error loading reference image ${url}: ${err.message}`);
    }
  }

  console.log(`\nGenerating ${count} image(s) with prompt: "${prompt}"`);
  console.log(
    `Using ${refImages.length} reference image(s) for style matching`,
  );
  if (context) {
    console.log(
      `With context: slide content=${!!slideContent}, deck text=${deckText.length > 0}`,
    );
  }

  // Ensure output directory exists
  if (outputPrefix) {
    mkdirSync(dirname(outputPrefix), { recursive: true });
  }

  const generatedFiles: string[] = [];

  for (let i = 0; i < count; i++) {
    try {
      console.log(`\nGenerating variation ${i + 1}/${count}...`);
      const result = await generateWithGemini(prompt, refImages, context);

      if (outputPrefix) {
        const filePath = `${outputPrefix}-v${i + 1}.png`;
        writeFileSync(filePath, result.imageData);
        generatedFiles.push(filePath);
        console.log(
          `Saved: ${filePath} (${Math.round(result.imageData.length / 1024)}KB)`,
        );
      } else {
        const dataUrl = `data:${result.mimeType};base64,${result.imageData.toString("base64")}`;
        console.log(`\nGenerated image ${i + 1}:`);
        console.log(`  MIME type: ${result.mimeType}`);
        console.log(`  Size: ${Math.round(result.imageData.length / 1024)}KB`);
        console.log(
          `  Data URL (first 100 chars): ${dataUrl.substring(0, 100)}...`,
        );
      }
    } catch (err: any) {
      console.error(`Failed to generate variation ${i + 1}: ${err.message}`);
    }
  }

  if (generatedFiles.length > 0) {
    console.log(`\n✓ Generated ${generatedFiles.length} image(s):`);
    for (const f of generatedFiles) {
      console.log(`  ${f}`);
    }
  }

  console.log("\nDone!");
}
