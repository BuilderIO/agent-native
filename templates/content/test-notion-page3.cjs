const { Client } = require("@notionhq/client");
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  try {
    const res = await notion.dataSources.retrieve({
      data_source_id: "de33fd2e-fcfa-44ba-9dfc-9b673af92e32",
    });
    const titleProp = Object.entries(res.properties).find(
      ([k, v]) => v.type === "title",
    );
    console.log("Title property is:", titleProp[0]);
  } catch (e) {
    console.error(e.message);
  }
}
run();
