import { computeBlockDiff } from "../server/routes/notion-diff.ts";
import {
  getNotionMetadata,
  parseFrontmatter,
} from "../client/lib/frontmatter.ts";
import { markdownToNotionBlocks } from "../client/lib/markdown-to-notion.ts";
import * as fs from "fs";
import * as path from "path";

const mdPath = path.resolve(
  process.cwd(),
  "content/projects/alice/how-to-run-claude-code-on-mobile/draft.md",
);
const md = fs.readFileSync(mdPath, "utf-8");
const md2 = md.replace("Testing.", "Testing again.");
const parsed1 = parseFrontmatter(md);
const parsed2 = parseFrontmatter(md2);

const blocks1 = markdownToNotionBlocks(parsed1.content);
const blocks2 = markdownToNotionBlocks(parsed2.content);

console.time("diff");
const ops = computeBlockDiff(blocks1, blocks2);
console.timeEnd("diff");
console.log(ops.length, "operations");
