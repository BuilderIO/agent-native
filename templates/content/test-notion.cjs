const { Client } = require("@notionhq/client");
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  try {
    const res = await notion.search({
      filter: { property: "object", value: "data_source" },
    });
    console.log(
      res.results.map((db) => ({
        id: db.id,
        title: (db.title || db.properties?.Name?.title || [])[0]?.plain_text,
      })),
    );
  } catch (e) {
    console.error(e);
  }
}
run();
