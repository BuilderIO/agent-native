const { Client } = require("@notionhq/client");
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  try {
    const all = await notion.dataSources.query({
      data_source_id: "de33fd2e-fcfa-44ba-9dfc-9b673af92e32",
    });

    // Print out 10 recent titles and their URLs to see what's actually there
    all.results.slice(0, 10).forEach((p) => {
      const titleProp = Object.values(p.properties).find(
        (prop) => prop.type === "title",
      );
      const titleText = titleProp?.title?.[0]?.plain_text || "Untitled";
      const url = p.properties["Published URL"]?.url || "none";
      console.log(`- ${titleText} [${url}]`);
    });
  } catch (e) {
    console.error(e);
  }
}
run();
