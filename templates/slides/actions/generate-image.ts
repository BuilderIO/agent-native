
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
    const res = await ssrfSafeFetch(
      url,
      { signal: AbortSignal.timeout(30_000) },
      { httpsOnly: true, maxRedirects: 2 },
    ).catch((err: unknown) => {
      console.error(
        `Could not download ${url}: ${err instanceof Error ? err.message : (JSON.stringify(err) ?? "")}`,
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

function loadDeckContext(
  deckId: string,
  slideId?: string,
): { slideContent?: string; deckText: string } {
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
    console.log(delegation.reply);
    const previewUrl = extractAssetUrl(delegation.reply, {
      baseUrl: delegation.target,
    });
    if (previewUrl) {
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

  const referenceUrls = [
    ...DEFAULT_STYLE_REFERENCE_URLS,
    ...extraReferenceUrls,
  ];

  const refFetchLimit = pLimit(4);
  const refImages = (
    await Promise.all(
      referenceUrls.map((url) =>
        refFetchLimit(async () => {
          try {
            console.log(`Loading reference image: ${url}`);
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

  if (outputPrefix) {
    mkdirSync(dirname(outputPrefix), { recursive: true });
  }

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
      console.error(
        `Failed to generate variation: ${err instanceof Error ? err.message : JSON.stringify(err)}`,
      );
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
