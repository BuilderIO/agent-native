import { Client } from "@notionhq/client";
import { loadEnv, parseArgs, camelCaseArgs } from "./_utils.js";

export default async function main(args: string[]) {
  loadEnv();

  const rawArgs = parseArgs(args);
  const opts = camelCaseArgs(rawArgs);

  if (opts.help) {
    console.log(
      'Usage: npm run script -- notion-search --query "Content Calendar"',
    );
    return;
  }

  const query = opts.query || "Content Calendar";
  const apiKey = process.env.NOTION_API_KEY;

  if (!apiKey) {
    console.error("Error: NOTION_API_KEY environment variable is not set.");
    process.exit(1);
  }

  const notion = new Client({ auth: apiKey });

  try {
    const response = await notion.search({
      query: query,
      sort: {
        direction: "descending",
        timestamp: "last_edited_time",
      },
    });

    if (response.results.length === 0) {
      console.log(`No databases found matching query: "${query}"`);
      return;
    }

    console.log(
      `Found ${response.results.length} database(s) matching "${query}":\n`,
    );

    response.results.forEach((db: any) => {
      const title = db.title?.[0]?.plain_text || "Untitled Database";
      console.log(`Title: ${title}`);
      console.log(`ID: ${db.id}`);
      console.log(`URL: ${db.url}`);
      console.log(`Last Edited: ${db.last_edited_time}`);
      console.log("--------------------------------------------------");
    });
  } catch (error: any) {
    console.error("Error searching Notion:", error.message);
  }
}
