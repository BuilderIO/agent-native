const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  try {
    const res = await notion.dataSources.query({ data_source_id: 'de33fd2e-fcfa-44ba-9dfc-9b673af92e32' });
    console.log(JSON.stringify(res.results.slice(0, 2), null, 2));
  } catch (e) {
    console.error(e);
  }
}
run();
