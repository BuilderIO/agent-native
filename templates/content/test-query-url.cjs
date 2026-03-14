const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  try {
    const res = await notion.dataSources.query({
      data_source_id: 'de33fd2e-fcfa-44ba-9dfc-9b673af92e32',
      filter: {
        property: "Published URL",
        url: {
          contains: "headless-cms"
        }
      }
    });
    console.log("Found:", res.results.length);
    if(res.results.length > 0) {
      console.log(res.results[0].properties["Published URL"]);
    }
  } catch (e) {
    console.error(e);
  }
}
run();
