import { loadEnv } from "./_utils.js";
import { Client } from "@notionhq/client";
export default async function main() {
  loadEnv();
  const token = process.env.NOTION_API_KEY;
  const notion = new Client({ auth: token });
  try {
    const res = await notion.blocks.children.append({
      block_id: "30a3d727-4be5-804e-885f-f8681d267229",
      children: [{ paragraph: { rich_text: [{ text: { content: "Test Start" } }] } }] as any,
      position: { type: "start" }
    } as any);
    console.log("Success with position:start");
  } catch (e: any) {
    console.error("Error with position:", e.message);
  }
}
