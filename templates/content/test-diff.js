import { markdownToBuilder } from "./client/lib/markdown-to-builder.js";
import { builderToMarkdown } from "./client/lib/builder-to-markdown.js";

const md = `| Feature | Cursor | Fusion | Claude Code |
| :--- | :--- | :--- | :--- |
| **Primary Interface** | GUI (VS Code) | Visual Canvas | Terminal CLI |
| **Agentic Capability** | High (Composer) | High (Visual) | Extreme |
| **Cost** | $20-$40/mo | Variable | Usage-based |`;

async function run() {
  const result = await markdownToBuilder(md);
  const back = builderToMarkdown(result.blocks);
  console.log("Original MD:\n" + md);
  console.log("-------------------");
  console.log("Roundtrip MD:\n" + back);
  console.log("-------------------");
  const rmFull = md.trim();
  const lmFull = back.trim();
  let firstDiff = -1;
  for (let i = 0; i < Math.max(rmFull.length, lmFull.length); i++) {
    if (rmFull[i] !== lmFull[i]) {
      firstDiff = i;
      break;
    }
  }
  if (firstDiff !== -1) {
    console.log(`diff at ${firstDiff}`);
    console.log(
      `r: ${JSON.stringify(rmFull.substring(firstDiff - 10, firstDiff + 10))}`,
    );
    console.log(
      `l: ${JSON.stringify(lmFull.substring(firstDiff - 10, firstDiff + 10))}`,
    );
  }
}
run();
