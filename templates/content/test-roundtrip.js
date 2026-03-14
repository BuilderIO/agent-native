import { markdownToBuilder } from './client/lib/markdown-to-builder.js';
import { builderToMarkdown } from './client/lib/builder-to-markdown.js';

const md = `| Feature | Cursor | Fusion | Claude Code |
| --- | --- | --- | --- |
| **Primary Interface** | GUI (VS Code) | Visual Canvas | Terminal CLI |
| **Agentic Capability** | High (Composer) | High (Visual) | Extreme |`;

async function run() {
  const result = await markdownToBuilder(md);
  console.log("Blocks:", JSON.stringify(result.blocks, null, 2));
  const back = builderToMarkdown(result.blocks);
  console.log("Back to MD:", back);
}
run();
