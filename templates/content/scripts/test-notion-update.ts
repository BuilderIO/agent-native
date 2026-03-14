import { Client } from "@notionhq/client";
import { loadEnv } from "./_utils";

export default async function main() {
  loadEnv();
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  try {
    const page = await notion.pages.create({
      parent: { database_id: "db4ae46c-8224-43ba-96e5-1a6a352e0fbe" },
      properties: { "Project": { title: [{ text: { content: "Test" } }] } },
      children: [{ type: "paragraph", paragraph: { rich_text: [{ text: { content: "P" } }] } }]
    });
    
    const blocks = await notion.blocks.children.list({ block_id: page.id });
    const blockId = blocks.results[0].id;
    
    await notion.blocks.update({
      block_id: blockId,
      paragraph: undefined,
      type: "heading_1",
      heading_1: { rich_text: [{ text: { content: "H1" } }] }
    } as any);
    
    console.log("UPDATE TYPE WORKED!");
    await notion.pages.update({ page_id: page.id, archived: true });
  } catch (e) {
    console.error("UPDATE TYPE FAILED:", e.message);
  }
}
