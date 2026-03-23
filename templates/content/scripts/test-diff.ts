import { loadEnv } from "./_utils.js";
import { Client } from "@notionhq/client";
import { computeBlockDiff } from "../server/handlers/notion-diff.js";
import { readFileSync } from "fs";
import { parseFrontmatter } from "../app/lib/frontmatter.js";
import { markdownToNotionBlocks } from "../app/lib/markdown-to-notion.js";

export default async function main() {
  loadEnv();
  const token = process.env.NOTION_API_KEY;
  const notion = new Client({ auth: token });

  // fetch existing blocks
  let existingBlocks: any[] = [];
  let cursor: string | undefined = undefined;
  do {
    const { results, next_cursor } = await notion.blocks.children.list({
      block_id: "30a3d727-4be5-804e-885f-f8681d267229",
      start_cursor: cursor,
    });
    existingBlocks.push(...results);
    cursor = next_cursor || undefined;
  } while (cursor);

  // read local markdown
  const md = readFileSync(
    "content/projects/alice/claude-code-for-designers/draft.md",
    "utf8",
  );
  const parsedMd = parseFrontmatter(md);

  let contentToConvert = parsedMd.content;
  const heroImage = parsedMd.data.hero_image;
  if (heroImage) {
    contentToConvert = `![](${heroImage})\n\n${contentToConvert}`;
  }

  const newBlocks = markdownToNotionBlocks(contentToConvert);

  const ops = computeBlockDiff(existingBlocks, newBlocks);

  const stats = { keep: 0, update: 0, insert: 0, delete: 0 };
  ops.forEach((o) => stats[o.type]++);
  console.log("Diff ops:", stats);
}
