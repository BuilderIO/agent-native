const { Client } = require("@notionhq/client");
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  try {
    const res = await notion.dataSources.query({
      data_source_id: "de33fd2e-fcfa-44ba-9dfc-9b673af92e32",
      filter: {
        property: "Published URL",
        url: {
          contains: "how-to-run-claude-code-on-mobile",
        },
      },
    });
    console.log("Filtered results:", res.results.length);

    // Fallback: fetch all and check manually to see if it exists
    const all = await notion.dataSources.query({
      data_source_id: "de33fd2e-fcfa-44ba-9dfc-9b673af92e32",
    });

    const matchingTitle = all.results.find((p) => {
      const titleProp = Object.values(p.properties).find(
        (prop) => prop.type === "title",
      );
      const titleText = titleProp?.title?.[0]?.plain_text || "";
      return titleText.toLowerCase().includes("claude code");
    });

    if (matchingTitle) {
      console.log("Found by title:", matchingTitle.id);
      console.log(
        "Its Published URL is:",
        matchingTitle.properties["Published URL"],
      );
    } else {
      console.log("Not found by title either");
    }
  } catch (e) {
    console.error(e);
  }
}
run();
