const { Client } = require("@notionhq/client");
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  try {
    const res = await notion.databases.retrieve({
      database_id: "de33fd2e-fcfa-44ba-9dfc-9b673af92e32",
    });
    console.log("Found database:", res.title[0]?.plain_text);
    console.log("Properties:", Object.keys(res.properties));
  } catch (e) {
    console.error(e);
  }
}
run();
