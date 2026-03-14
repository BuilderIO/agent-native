const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  try {
    const res = await notion.search({
      filter: { value: 'database', property: 'object' }
    });
    console.log(res.results.map(db => ({ id: db.id, title: db.title[0]?.plain_text })));
  } catch (e) {
    console.error(e);
  }
}
run();
