import { computeBlockDiff } from "../server/routes/notion-diff.ts";
import {
  getNotionMetadata,
  parseFrontmatter,
} from "../client/lib/frontmatter.ts";
import { markdownToNotionBlocks } from "../client/lib/markdown-to-notion.ts";
import { Client } from "@notionhq/client";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" }); // need to point to root .env

const client = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  const mdPath = path.resolve(
    process.cwd(),
    "content/projects/alice/how-to-run-claude-code-on-mobile/draft.md",
  );
  const md = fs.readFileSync(mdPath, "utf-8");
  const notionMeta = getNotionMetadata(md);
  const parsed = parseFrontmatter(md);

  const pageId = notionMeta.page_id;
  console.log("Page ID", pageId);

  let existingBlocks: any[] = [];
  let cursor: string | undefined = undefined;
  do {
    const { results, next_cursor } = await client.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
    });
    existingBlocks.push(...results);
    cursor = next_cursor || undefined;
  } while (cursor);

  let contentToConvert = parsed.content;
  const heroImage = parsed.data.hero_image || parsed.data.builder?.image;
  if (heroImage) {
    contentToConvert = `![](${heroImage})\n\n${contentToConvert}`;
  }

  const newBlocks = markdownToNotionBlocks(contentToConvert);

  console.log("Existing blocks:", existingBlocks.length);
  console.log("New blocks:", newBlocks.length);

  const ops = computeBlockDiff(existingBlocks, newBlocks);
  const counts = ops.reduce(
    (acc, op) => {
      acc[op.type] = (acc[op.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  console.log("Ops counts:", counts);
}

run().catch(console.error);
