import { loadEnv } from "./_utils.js";
import { Client } from "@notionhq/client";
import { computeBlockDiff } from "../server/routes/notion-diff.js";
import { readFileSync } from "fs";
import { parseFrontmatter } from "../client/lib/frontmatter.js";
import { markdownToNotionBlocks } from "../client/lib/markdown-to-notion.js";

export default async function main() {
  loadEnv();
  const token = process.env.NOTION_API_KEY;
  const notion = new Client({ auth: token });
  
  const pageId = "30a3d727-4be5-804e-885f-f8681d267229"; // claude-code-for-designers
  
  let existingBlocks: any[] = [];
  let cursor: string | undefined = undefined;
  do {
    const { results, next_cursor } = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
    });
    existingBlocks.push(...results);
    cursor = next_cursor || undefined;
  } while (cursor);
  
  const md = readFileSync("content/projects/alice/claude-code-for-designers/draft.md", "utf8");
  const parsedMd = parseFrontmatter(md);
  
  let contentToConvert = parsedMd.content;
  const heroImage = parsedMd.data.hero_image;
  if (heroImage) {
    contentToConvert = `![](${heroImage})\n\n${contentToConvert}`;
  }
  
  const newBlocks = markdownToNotionBlocks(contentToConvert);
  const ops = computeBlockDiff(existingBlocks, newBlocks);
  
  console.log(`Found ${ops.length} ops`);
  
  const deletes = ops.filter(o => o.type === 'delete');
  console.log(`Need to delete ${deletes.length} blocks`);
  
  let count = 0;
  for (const op of deletes) {
    if (op.type === 'delete') {
      const oldBlock = existingBlocks[op.oldIndex];
      try {
        await notion.blocks.delete({ block_id: oldBlock.id });
        count++;
        console.log(`Deleted ${count}/${deletes.length}`);
      } catch (e: any) {
        console.error("Failed to delete", e.message);
      }
      await new Promise(r => setTimeout(r, 350));
    }
  }
  
  console.log("Cleanup done.");
}
