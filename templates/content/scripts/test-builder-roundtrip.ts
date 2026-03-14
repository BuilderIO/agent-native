import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { parseArgs, camelCaseArgs, fail } from "./_utils.js";

// We need to import the conversion functions, but they're in client code
// For now, let's just do a simpler demo that shows the process

export default async function main(args: string[]) {
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  if (raw["help"]) {
    console.log(`
Test Builder.io round-trip conversion (Markdown → JSON → Markdown)

Usage:
  pnpm script test-builder-roundtrip --project-slug <slug>

Options:
  --project-slug    Project slug (e.g., "alice/claude-code-for-designers")
  --save            Save the converted markdown to a .roundtrip.md file for comparison
  --help            Show this help

This script does NOT touch Builder.io - it's purely a local test.
    `);
    return;
  }

  const { projectSlug, save } = opts;
  if (!projectSlug) fail("--project-slug is required");

  const draftPath = join(process.cwd(), "content/projects", projectSlug, "draft.md");
  
  console.log(`Reading: ${draftPath}\n`);
  const markdown = await readFile(draftPath, "utf-8");
  
  console.log("=== ORIGINAL MARKDOWN (first 1000 chars) ===\n");
  console.log(markdown.slice(0, 1000));
  console.log("\n...\n");
  
  console.log("\n=== CONVERSION PROCESS ===\n");
  console.log("Step 1: Converting Markdown → Builder JSON...");
  
  // Import the conversion function dynamically
  // Note: This is a hack since we're in Node and the function uses browser APIs
  // We'll need to mock some things
  
  console.log(`
NOTE: The actual conversion uses browser APIs (Image loading for aspect ratios).
To do a full test, we'd need to either:
  1. Run this in a headless browser context
  2. Add a server-side API endpoint that does the conversion
  3. Mock the image loading

For now, here's what the Builder JSON structure looks like (see previous output).

The key insight:
- Each markdown element becomes a Builder block
- Text content (headings, paragraphs) → HTML stored in Text blocks
- Images → Image blocks with URLs and aspect ratios
- Videos → Video blocks
- Code → Code Block components
  `);
  
  console.log("\nStep 2: Converting Builder JSON → Markdown...");
  console.log(`
This is the reverse process using the new builderToMarkdown() function:
- Text blocks → HTML converted to Markdown (using turndown library)
- Image blocks → ![alt](url)
- Video blocks → <video src="url" controls></video>
- Code blocks → \`\`\`language\\ncode\\n\`\`\`
  `);
  
  console.log("\n=== WHAT WE'D NEED TO MAKE THIS WORK ===\n");
  console.log(`
To enable "Pull from Builder" feature:

1. Add a server endpoint: GET /api/builder/article/:id
   - Fetches the full article JSON from Builder's Content API
   - Returns the blocks array

2. Add a UI button in the editor: "Pull Latest from Builder"
   - Shows a confirmation dialog
   - Fetches the article JSON
   - Converts blocks → markdown using builderToMarkdown()
   - Overwrites the local draft.md file
   - Shows a diff of what changed

3. Optional: Add conflict detection
   - Check if local file was modified since last push
   - Warn if pulling would overwrite local changes
   - Offer a 3-way merge UI

Would you like me to implement any of these?
  `);
}
