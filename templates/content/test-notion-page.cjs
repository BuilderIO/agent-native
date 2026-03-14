const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  try {
    const response = await notion.pages.create({
      parent: { database_id: 'de33fd2e-fcfa-44ba-9dfc-9b673af92e32' },
      properties: {
        "Name": {
          title: [
            {
              text: { content: "Test Page" }
            }
          ]
        }
      }
    });
    console.log("Success", response.id);
  } catch (e) {
    console.error(e.message);
  }
}
run();
