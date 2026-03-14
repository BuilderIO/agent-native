import { Client } from "@notionhq/client";
import { loadEnv, parseArgs, camelCaseArgs } from "./_utils.js";

export default async function main(args: string[]) {
  loadEnv();
  const rawArgs = parseArgs(args);
  const opts = camelCaseArgs(rawArgs);
  const apiKey = process.env.NOTION_API_KEY;
  
  if (!apiKey) {
    console.error("NO API KEY");
    return;
  }
  
  const notion = new Client({ auth: apiKey });

  const dbId = opts.id || "de33fd2e-fcfa-44ba-9dfc-9b673af92e32";

  try {
    const response = await notion.databases.retrieve({ database_id: dbId });
    // @ts-ignore
    console.log(JSON.stringify(response.properties, null, 2));
  } catch (error: any) {
    console.error("Error retrieving database:", error.message);
  }
}
