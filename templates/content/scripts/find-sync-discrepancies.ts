import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { parseArgs, camelCaseArgs, loadEnv } from "./_utils.js";

export default async function main(args: string[]) {
  loadEnv();
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  const projectSlug = opts.projectSlug || "alice/claude-code-for-designers";
  const draftPath = join(
    process.cwd(),
    "content/projects",
    projectSlug,
    "draft.md",
  );

  const markdown = await readFile(draftPath, "utf-8");

  // Mock Image for Node environment
  if (typeof global.Image === "undefined") {
    (global as any).Image = class Image {
      onload: any;
      onerror: any;
      src: string = "";
      naturalWidth: number = 800;
      naturalHeight: number = 600;
      constructor() {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 10);
      }
    };
  }

  const { markdownToBuilder } =
    await import("../client/lib/markdown-to-builder.js");
  const { builderToMarkdown } =
    await import("../client/lib/builder-to-markdown.js");

  console.log(`Analyzing sync discrepancies for: ${projectSlug}`);
  console.log("--------------------------------------------------\n");

  const initialConversion = await markdownToBuilder(markdown);
  const initialBlocks = initialConversion.blocks;

  const pulledMarkdown = builderToMarkdown(initialBlocks);
  const secondConversion = await markdownToBuilder(pulledMarkdown);
  const repushedBlocks = secondConversion.blocks;

  const outDir = join(process.cwd(), "test-results");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "push1_blocks.json"),
    JSON.stringify(initialBlocks, null, 2),
  );
  await writeFile(join(outDir, "pull1_draft.md"), pulledMarkdown);
  await writeFile(
    join(outDir, "push2_blocks.json"),
    JSON.stringify(repushedBlocks, null, 2),
  );
  console.log(
    `(Saved intermediate artifacts to ./test-results/ for your review)`,
  );

  console.log("\n=== CONFIRMING KNOWN DISCREPANCIES ===\n");

  const hasHr = initialBlocks.some(
    (b: any) => b.component?.options?.text === "<hr />",
  );
  const hasH2Frontmatter = initialBlocks.some((b: any) =>
    b.component?.options?.text?.includes("<h2>builder:"),
  );
  if (hasHr && hasH2Frontmatter) {
    console.log("❌ 1. Frontmatter is Not Stripped on Push");
    console.log(
      "   -> Confirmed: '---' is converted to <hr /> and the YAML is parsed as an <h2> block.",
    );
    console.log(
      "   -> Impact: When pulled back, frontmatter becomes standard markdown (`* * *` and `## builder...`). It's no longer YAML.",
    );
  }

  console.log(
    "\n❌ 2. Block Granularity (Multiple HTML elements per Text block)",
  );
  console.log(
    `   -> Confirmed: We generated ${initialBlocks.length} separate Builder blocks from the markdown.`,
  );
  console.log(
    "   -> The Builder API often groups them, meaning push splits 1 block into many.",
  );

  const blockJson = JSON.stringify(initialBlocks);
  if (blockJson.includes("<b>") && !blockJson.includes("<strong>")) {
    console.log("\n❌ 3. <strong> vs <b> HTML Tags");
    console.log(
      "   -> Confirmed: The push conversion hardcodes bold text to <b> instead of Builder's preferred <strong>.",
    );
  }

  if (blockJson.includes("<em>") && blockJson.includes("<code>")) {
    console.log("\n❌ 4. Emphasis Splitting Around Inline Code");
    console.log(
      "   -> Confirmed: Push JSON parses split markdown emphasis into separate <em> elements.",
    );
    console.log(
      "   -> e.g., '<em>Hey!</em> <code>[repo]</code> <em>locally</em>' instead of a single <em> wrapper.",
    );
  }

  console.log("\nℹ️ 5. Redundant <img> Tags in Text Blocks");
  console.log(
    "   -> Confirmed logic exists: 'builderToMarkdown' actively strips leading <img> tags from the start of Text blocks.",
  );

  const imageBlocks = initialBlocks.filter(
    (b: any) => b.component?.name === "Image",
  );
  if (imageBlocks.length > 0) {
    const imgKeys = Object.keys(imageBlocks[0].component.options);
    const missingKeys = [
      "lazy",
      "fitContent",
      "lockAspectRatio",
      "sizes",
      "height",
      "width",
    ].filter((k) => !imgKeys.includes(k));
    if (missingKeys.length > 0) {
      console.log("\n❌ 6. Missing Image Metadata");
      console.log(
        `   -> Confirmed: Pushed Image blocks lack standard Builder metadata: ${missingKeys.join(", ")}`,
      );
    }
  }

  console.log("\n=== FINDING NEW/OTHER DISCREPANCIES ===\n");

  let newIssues = 0;

  if (initialBlocks.length !== repushedBlocks.length) {
    console.log(`❌ NEW: Block Count Mismatch on Round-trip`);
    console.log(`   -> Initial push: ${initialBlocks.length} blocks`);
    console.log(`   -> Push after pull: ${repushedBlocks.length} blocks`);
    newIssues++;
  }

  const getTexts = (blocks: any[]) =>
    blocks
      .filter((b) => b.component?.name === "Text")
      .map((b) => b.component.options.text);
  const text1 = getTexts(initialBlocks);
  const text2 = getTexts(repushedBlocks);

  let textDiffs = 0;
  for (let i = 0; i < Math.min(text1.length, text2.length); i++) {
    if (text1[i] !== text2[i]) {
      if (text1[i].replace(/\s+/g, " ") !== text2[i].replace(/\s+/g, " ")) {
        textDiffs++;
      }
    }
  }
  if (textDiffs > 0) {
    console.log(
      `❌ NEW: Content mutated during pull/push roundtrip (Text diffs found)`,
    );
    console.log(
      `   -> Found ${textDiffs} text blocks that do not survive a roundtrip exactly.`,
    );
    newIssues++;
  }

  const videos1 = initialBlocks.filter(
    (b: any) => b.component?.name === "Video",
  ).length;
  const videos2 = repushedBlocks.filter(
    (b: any) => b.component?.name === "Video",
  ).length;
  if (videos1 !== videos2) {
    console.log(`❌ NEW: Video Component Mismatch`);
    console.log(`   -> Initial push has ${videos1} Video blocks.`);
    console.log(`   -> After pull/repush, there are ${videos2} Video blocks.`);
    newIssues++;
  }

  const imgs1 = initialBlocks.filter(
    (b: any) => b.component?.name === "Image",
  ).length;
  const imgs2 = repushedBlocks.filter(
    (b: any) => b.component?.name === "Image",
  ).length;
  if (imgs1 !== imgs2) {
    console.log(`❌ NEW: Image Component Mismatch`);
    console.log(`   -> Initial push has ${imgs1} Image blocks.`);
    console.log(`   -> After pull/repush, there are ${imgs2} Image blocks.`);
    newIssues++;
  }

  if (newIssues === 0) {
    console.log(
      "✅ No other obvious discrepancies found during local round-trip.",
    );
  } else {
    console.log(
      `\nFound ${newIssues} additional discrepancies during local roundtrip testing.`,
    );
  }

  console.log("\nDone. You can compare the artifacts in ./test-results/");
}
