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
 *   --model               Provider: 'gemini', 'openai', or 'auto' (default: auto)
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
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

import {
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch,
} from "@agent-native/core/extensions/url-safety";
import pLimit from "p-limit";

import {
  delegateImageGenerationToAssets,
  extractAssetUrl,
  extractAssetUrls,
  imagePreviewMarkdown,
  stripHtml,
} from "../server/lib/assets-image-delegation.js";
import { DEFAULT_STYLE_REFERENCE_URLS } from "../shared/api.js";

/**
 * `--output` promises files on disk, so a delegated generation has to download
 * what Assets produced instead of only printing the reply.
 */
async function saveDelegatedImages(
  reply: string,
  outputPrefix: string,
  baseUrl: string,
): Promise<void> {
  const urls = extractAssetUrls(reply, { prefer: "download", baseUrl });
  if (urls.length === 0) {
    console.error(
      `Assets returned no parseable image URL, so nothing was written to ${outputPrefix}.`,
    );
    throw new Error("Script failed");
  }
  mkdirSync(dirname(outputPrefix), { recursive: true });
  let failures = 0;
  for (const [i, url] of urls.entries()) {
    // ssrfSafeFetch validates at connect time and on every redirect hop, so a
    // DNS rebind between check and connect cannot reach an internal address.
    const res = await ssrfSafeFetch(
      url,
      { signal: AbortSignal.timeout(30_000) },
      { httpsOnly: true, maxRedirects: 2 },
    ).catch((err: unknown) => {
      console.error(
        `Could not download ${url}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    });
    if (!res || !res.ok) {
      if (res) console.error(`Could not download ${url} (${res.status}).`);
      failures++;
      continue;
    }
    const filePath = `${outputPrefix}-v${i + 1}.png`;
    writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
    console.log(`Saved: ${filePath}`);
  }
  // `--output` is a promise of files on disk, so exiting 0 with some of them
  // missing sends the caller on to paths that do not exist.
  if (failures > 0) {
    console.error(
      `${failures} of ${urls.length} generated image(s) could not be saved to ${outputPrefix}.`,
    );
    throw new Error("Script failed");
  }
}

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
  --model                 Provider: 'gemini', 'openai', or 'auto' (default: auto)
  --reference-image-urls  Comma-separated URLs of extra reference images
  --count                 Number of variations (default: 1)
  --output                Output file path prefix (files: {prefix}-v1.png, etc.)
  --help                  Show this help`);
    return;
  }

  const prompt = opts["prompt"];
  if (!prompt) {
    console.error("Error: --prompt is required");
    throw new Error("Script failed");
  }

  const count = parseInt(opts["count"] || "1", 10);
  const outputPrefix = opts["output"];
  const extraReferenceUrls = opts["reference-image-urls"]
    ? opts["reference-image-urls"].split(",").map((u) => u.trim())
    : [];

  // Build context from slide content and/or deck. This runs before delegation
  // so Assets receives the real slide text, not a bare deck id.
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

  // Assets owns image generation. Only fall through to the local providers
  // below when it cannot be reached, so a standalone slides deploy still
  // works. See the `image-generation-via-a2a` skill for the contract.
  const delegation = await delegateImageGenerationToAssets({
    prompt,
    count,
    deckId: opts["deck-id"],
    slideId: opts["slide-id"],
    slideContent,
    ...(extraReferenceUrls.length
      ? { referenceImageUrls: extraReferenceUrls }
      : {}),
  });
  if (delegation.status === "delegated") {
    // Print the reply verbatim so the calling agent parses URLs the Assets
    // agent actually returned.
    console.log(delegation.reply);
    const previewUrl = extractAssetUrl(delegation.reply, {
      baseUrl: delegation.target,
    });
    if (previewUrl) {
      // Hand back finished markdown: a bare link renders as text in chat, so
      // the user would see no image at all.
      console.log(
        `\nShow this to the user verbatim so the image renders inline:\n` +
          imagePreviewMarkdown(prompt, previewUrl),
      );
    }
    if (outputPrefix) {
      await saveDelegatedImages(
        delegation.reply,
        outputPrefix,
        delegation.target,
      );
    }
    return;
  }
  if (delegation.status === "pending") {
    console.error(
      `Assets is still generating (task ${delegation.taskId}, last state ` +
        `"${delegation.lastState}"). It was not cancelled — check the Assets ` +
        `app rather than generating a duplicate.`,
    );
    throw new Error("Script failed");
  }
  if (delegation.status === "rejected") {
    console.error(
      `Assets could not generate this image (${delegation.state}): ${delegation.reason}`,
    );
    throw new Error("Script failed");
  }
  console.warn(
    `[slides/generate-image] Assets unavailable (${delegation.reason}); ` +
      `using the local fallback provider — output will not be brand-grounded.`,
  );

  // Validate that at least one provider is configured
  const { getProvider } =
    await import("../server/handlers/image-providers/index.js");
  const modelChoice = opts["model"] || "auto";
  let provider: Awaited<ReturnType<typeof getProvider>>;
  try {
    provider = await getProvider(modelChoice);
  } catch {
    console.error(
      "Error: No image generation provider configured. Save GEMINI_API_KEY or OPENAI_API_KEY in settings.",
    );
    throw new Error("Script failed");
  }

  const context =
    slideContent || deckText ? { slideContent, deckText } : undefined;

  // Always include default style references + any extra ones
  const referenceUrls = [
    ...DEFAULT_STYLE_REFERENCE_URLS,
    ...extraReferenceUrls,
  ];

  // Load reference images from URLs in parallel (capped concurrency to avoid
  // overwhelming the network and to keep the agent within its run budget).
  const refFetchLimit = pLimit(4);
  const refImages = (
    await Promise.all(
      referenceUrls.map((url) =>
        refFetchLimit(async () => {
          try {
            console.log(`Loading reference image: ${url}`);
            // SSRF guard: extra reference URLs are agent-supplied. Block
            // private/internal targets and do not follow redirects into them.
            if (await isBlockedExtensionUrlWithDns(url)) {
              console.warn(`Blocked private/internal reference image: ${url}`);
              return null;
            }
            const res = await fetch(url, {
              signal: AbortSignal.timeout(8000),
              redirect: "manual",
            });
            if (res.status >= 300 && res.status < 400) {
              console.warn(`Refusing redirected reference image: ${url}`);
              return null;
            }
            if (!res.ok) {
              console.warn(`Failed to load reference image: ${url}`);
              return null;
            }
            const contentType = res.headers.get("content-type") || "image/png";
            const buffer = Buffer.from(await res.arrayBuffer());
            return {
              data: buffer.toString("base64"),
              mimeType: contentType.split(";")[0].trim(),
            };
          } catch (err: any) {
            console.warn(
              `Error loading reference image ${url}: ${err.message}`,
            );
            return null;
          }
        }),
      ),
    )
  ).filter((r): r is { data: string; mimeType: string } => r !== null);

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

  // Generate variations concurrently. Default to 2 in flight to stay under the
  // image-provider rate limits (Gemini and OpenAI both have low TPM/RPM caps);
  // tunable via IMAGE_GEN_CONCURRENCY without redeploying.
  const genLimit = pLimit(
    Math.max(1, Number(process.env.IMAGE_GEN_CONCURRENCY) || 2),
  );
  const variantResults = await Promise.allSettled(
    Array.from({ length: count }, (_, i) =>
      genLimit(async () => {
        console.log(`\nGenerating variation ${i + 1}/${count}...`);
        const result = await provider.generate(prompt, refImages, context);
        return { i, result };
      }),
    ),
  );

  const generatedFiles: string[] = [];

  for (const settled of variantResults) {
    if (settled.status === "rejected") {
      const err = settled.reason as { message?: string } | undefined;
      console.error(`Failed to generate variation: ${err?.message ?? err}`);
      continue;
    }
    const { i, result } = settled.value;
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
  }

  if (generatedFiles.length > 0) {
    console.log(`\n✓ Generated ${generatedFiles.length} image(s):`);
    for (const f of generatedFiles) {
      console.log(`  ${f}`);
    }
  }

  console.log("\nDone!");
}
