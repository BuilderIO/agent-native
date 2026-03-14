const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  try {
    const handle = 'claude-code-mobile-phone';
    
    // First let's query our normal endpoint
    const response = await notion.dataSources.query({
      data_source_id: 'de33fd2e-fcfa-44ba-9dfc-9b673af92e32',
      filter: {
        property: "Published URL",
        url: {
          contains: handle,
        },
      },
    });
    
    console.log("Found matches with query:", response.results.length);
    if(response.results.length > 0) {
      console.log("Match 0 id:", response.results[0].id);
    } else {
      console.log("No match found for handle:", handle);
      console.log("Wait, the property says 'https://builder.io/blog/claude-code-mobile-phone'");
    }
  } catch (e) {
    console.error(e.message);
  }
}
run();
