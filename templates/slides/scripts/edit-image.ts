/**
 * Edit an existing image using Gemini.
 * Pass in an image file and editing instructions.
 *
 * Usage:
 *   pnpm script edit-image --input public/generated/slide5-v3.png --prompt "Remove the background and make it transparent. Remove any logos." --output public/assets/generated/slide5-edited
 */

const config = async () => {
  try {
    const m = await import("dotenv");
    m.config();
  } catch {}
};
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

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

export default async function main(args: string[]) {
  await config();

  const opts = parseArgs(args);
  const inputPath = opts["input"];
  const prompt = opts["prompt"];
  const outputPrefix = opts["output"];
  const count = parseInt(opts["count"] || "1", 10);

  if (!inputPath || !prompt) {
    console.error(
      "Usage: pnpm script edit-image --input <path> --prompt <instructions> [--output <prefix>] [--count N]",
    );
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("Error: GEMINI_API_KEY not set");
    process.exit(1);
  }

  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Read the input image
  const imgBuffer = readFileSync(inputPath);
  const imgBase64 = imgBuffer.toString("base64");
  const mimeType = inputPath.endsWith(".png") ? "image/png" : "image/jpeg";

  console.log(
    `Input image: ${inputPath} (${Math.round(imgBuffer.length / 1024)}KB)`,
  );
  console.log(`Edit prompt: "${prompt}"`);
  console.log(`Generating ${count} variation(s)...\n`);

  if (outputPrefix) {
    mkdirSync(dirname(outputPrefix), { recursive: true });
  }

  const generatedFiles: string[] = [];

  for (let i = 0; i < count; i++) {
    console.log(`Generating variation ${i + 1}/${count}...`);

    const contents = [
      {
        inlineData: {
          mimeType,
          data: imgBase64,
        },
      },
      {
        text: `Edit this image with the following changes: ${prompt}

Keep everything else about the image the same - same style, same composition, same elements (except what's being changed). Output the edited image.`,
      },
    ];

    const models = ["gemini-3-pro-image-preview", "gemini-2.5-flash-image"];
    let success = false;

    for (const modelName of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, attempt * 3000));
          }
          console.log(
            `  [Gemini] Trying ${modelName} (attempt ${attempt + 1})`,
          );

          const response = await client.models.generateContent({
            model: modelName,
            contents,
            config: { responseModalities: ["TEXT", "IMAGE"] },
          });

          const parts = response.candidates?.[0]?.content?.parts ?? [];
          for (const part of parts) {
            if (part.inlineData) {
              const buffer = Buffer.from(part.inlineData.data!, "base64");
              const ext = part.inlineData.mimeType?.includes("png")
                ? "png"
                : "png";

              if (outputPrefix) {
                const filePath = `${outputPrefix}-v${i + 1}.${ext}`;
                writeFileSync(filePath, buffer);
                generatedFiles.push(filePath);
                console.log(
                  `  Saved: ${filePath} (${Math.round(buffer.length / 1024)}KB)`,
                );
              } else {
                console.log(
                  `  Generated (${Math.round(buffer.length / 1024)}KB)`,
                );
              }
              success = true;
              break;
            }
          }
          if (success) break;
        } catch (e: any) {
          console.warn(
            `  [Gemini] ${modelName} attempt ${attempt + 1} failed: ${e.message}`,
          );
          if (e.status === 429 || e.status === 503) continue;
          break;
        }
      }
      if (success) break;
    }

    if (!success) {
      console.error(`  Failed to generate variation ${i + 1}`);
    }
  }

  if (generatedFiles.length > 0) {
    console.log(`\n✓ Generated ${generatedFiles.length} edited image(s):`);
    for (const f of generatedFiles) {
      console.log(`  ${f}`);
    }
  }

  console.log("\nDone!");
}
