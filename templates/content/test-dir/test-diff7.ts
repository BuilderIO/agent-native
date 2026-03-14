import { hashBlock as originalHashBlock, computeBlockDiff } from "../server/routes/notion-diff.ts";
import { getNotionMetadata, parseFrontmatter } from "../client/lib/frontmatter.ts";
import { markdownToNotionBlocks } from "../client/lib/markdown-to-notion.ts";
import { Client } from "@notionhq/client";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

const client = new Client({ auth: process.env.NOTION_API_KEY });

function myHashBlock(block: any): string {
  if (!block || !block.type) return "";
  
  const type = block.type;
  const data = block[type] || {};

  const repr: any = { type };

  if (data.rich_text) {
    repr.rich_text = data.rich_text.map((rt: any) => {
      const a = rt.annotations || {};
      const annotations: any = {};
      if (a.bold) annotations.bold = true;
      if (a.italic) annotations.italic = true;
      if (a.strikethrough) annotations.strikethrough = true;
      if (a.underline) annotations.underline = true;
      if (a.code) annotations.code = true;
      if (a.color && a.color !== "default") annotations.color = a.color;

      return {
        content: rt.text?.content || "",
        link: rt.text?.link?.url || rt.href || null,
        annotations
      };
    });
  }
  
  if (type === "to_do") {
    repr.checked = data.checked || false;
  } else if (type === "code") {
    repr.language = data.language || "plain text";
  } else if (["image", "video", "file", "pdf"].includes(type)) {
    const fileType = data.type; 
    if (fileType && data[fileType]) {
      repr.url = data[fileType].url;
    } else if (data.external) {
      repr.url = data.external.url;
    } else if (data.file) {
      repr.url = data.file.url;
    }
  } else if (type === "equation") {
    repr.expression = data.expression || "";
  } else if (type === "bookmark") {
    repr.url = data.url || "";
  } else if (type === "callout") {
    repr.icon = data.icon || null;
    repr.color = data.color || "default";
  } else if (type === "heading_1" || type === "heading_2" || type === "heading_3") {
    repr.is_toggleable = data.is_toggleable || false;
    repr.color = data.color || "default";
  } else if (type === "bulleted_list_item" || type === "numbered_list_item" || type === "paragraph" || type === "quote") {
    repr.color = data.color || "default";
  }
  
  return JSON.stringify(repr);
}

async function run() {
  const mdPath = path.resolve(process.cwd(), "content/projects/alice/how-to-run-claude-code-on-mobile/draft.md");
  const md = fs.readFileSync(mdPath, "utf-8");
  const notionMeta = getNotionMetadata(md);
  const parsed = parseFrontmatter(md);
  
  const pageId = notionMeta.page_id;

  let existingBlocks: any[] = [];
  const { results } = await client.blocks.children.list({ block_id: pageId });
  existingBlocks = results;

  let contentToConvert = parsed.content;
  if (parsed.data.hero_image || parsed.data.builder?.image) {
    contentToConvert = `![](${parsed.data.hero_image || parsed.data.builder?.image})\n\n${contentToConvert}`;
  }

  const newBlocks = markdownToNotionBlocks(contentToConvert);

  const oldHashes = existingBlocks.map(myHashBlock);
  const newHashes = newBlocks.map(myHashBlock);
  
  let diffCount = 0;
  for(let i=0; i<oldHashes.length && i<newHashes.length; i++) {
     if(oldHashes[i] !== newHashes[i]) diffCount++;
  }
  console.log("Mismatches with new hash:", diffCount, "out of", Math.min(oldHashes.length, newHashes.length));
}

run().catch(console.error);
