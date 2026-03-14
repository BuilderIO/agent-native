import { readFile } from "fs/promises";
import { join } from "path";

// Import the conversion function from client code
// Note: This is a bit hacky since we're importing browser code into Node,
// but it works for demonstration purposes
async function convertMarkdownSample() {
  const markdownPath = join(
    process.cwd(),
    "content/projects/alice/claude-code-for-designers/draft.md",
  );

  const markdown = await readFile(markdownPath, "utf-8");

  // Take just the first few paragraphs for the demo
  const lines = markdown.split("\n");
  const excerpt = lines.slice(0, 10).join("\n");

  console.log("=== MARKDOWN EXCERPT ===\n");
  console.log(excerpt);
  console.log("\n\n=== BUILDER JSON (simplified structure) ===\n");

  // Manually show what the structure would be
  const sampleBlock = {
    "@type": "@builder.io/sdk:Element",
    id: "builder-abc123-1",
    component: {
      name: "Text",
      options: {
        text: "<h1>Claude Code for Designers</h1>",
      },
    },
    responsiveStyles: {
      large: {
        marginTop: "20px",
      },
    },
  };

  const paragraphBlock = {
    "@type": "@builder.io/sdk:Element",
    id: "builder-abc123-2",
    component: {
      name: "Text",
      options: {
        text: "<p>You spot a tiny UI issue on production. Fixing it in Figma takes 30 seconds, but shipping the code takes days of handoff, review cycles, and back-and-forth about design tokens.</p>",
      },
    },
    responsiveStyles: {
      large: {
        marginTop: "20px",
      },
    },
  };

  const boldParagraphBlock = {
    "@type": "@builder.io/sdk:Element",
    id: "builder-abc123-3",
    component: {
      name: "Text",
      options: {
        text: "<p><b>Claude Code</b> can help you move faster. It's an agent that can <b>open your repo, read files, make edits, and preview your app</b>—all from a workflow that's increasingly approachable for non-engineers.</p>",
      },
    },
    responsiveStyles: {
      large: {
        marginTop: "20px",
      },
    },
  };

  console.log(
    JSON.stringify([sampleBlock, paragraphBlock, boldParagraphBlock], null, 2),
  );

  console.log("\n\n=== FULL ARTICLE STRUCTURE ===");
  console.log(`
The full article would be an array of these blocks, one for each:
- Heading (h1, h2, h3, etc.)
- Paragraph (with inline HTML for bold, links, etc.)
- Image (with URL and aspect ratio)
- Video (with URL and playback options)
- Code block (with syntax highlighting)
- List (converted to <ul>/<ol> HTML)
- Blockquote (with border styling)
- Table (converted to <table> HTML)

Each block is a standalone Builder "Element" that gets rendered in sequence.
  `);
}

convertMarkdownSample().catch(console.error);
