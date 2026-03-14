const { Client } = require("@notionhq/client");
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  try {
    const res = await notion.dataSources.retrieve({
      data_source_id: "de33fd2e-fcfa-44ba-9dfc-9b673af92e32",
    });
    console.log("Success", res.title[0]?.plain_text);
  } catch (e) {
    console.error(e.message);
  }
}
run();
