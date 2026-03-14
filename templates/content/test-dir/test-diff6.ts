import { hashBlock } from "../server/routes/notion-diff.ts";
import { getNotionMetadata, parseFrontmatter } from "../client/lib/frontmatter.ts";
import { markdownToNotionBlocks } from "../client/lib/markdown-to-notion.ts";
import { Client } from "@notionhq/client";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

const client = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  const mdPath = path.resolve(process.cwd(), "content/projects/alice/how-to-run-claude-code-on-mobile/draft.md");
  const md = fs.readFileSync(mdPath, "utf-8");
  const parsed = parseFrontmatter(md);
  const notionMeta = getNotionMetadata(md);
  
  let existingBlocks: any[] = [];
  const { results } = await client.blocks.children.list({ block_id: notionMeta.page_id });
  existingBlocks = results;

  let contentToConvert = parsed.content;
  if (parsed.data.hero_image || parsed.data.builder?.image) {
    contentToConvert = `![](${parsed.data.hero_image || parsed.data.builder?.image})\n\n${contentToConvert}`;
  }
  const newBlocks = markdownToNotionBlocks(contentToConvert);

  for (let i = 0; i < 3; i++) {
    console.log("--- Block", i, "---");
    console.log("OLD HASH:", hashBlock(existingBlocks[i]));
    console.log("NEW HASH:", hashBlock(newBlocks[i]));
  }
}

run().catch(console.error);
