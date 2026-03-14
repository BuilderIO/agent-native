const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  try {
    const pageId = '3113d727-4be5-80be-936e-fcb875d6819d';
    const page = await notion.pages.retrieve({ page_id: pageId });
    console.log("Found specific page:", page.id);
    
    const titleProp = Object.values(page.properties).find(prop => prop.type === 'title');
    console.log("Title:", titleProp?.title?.[0]?.plain_text);
    console.log("URL:", page.properties["Published URL"]?.url);
    console.log("Parent data_source_id:", page.parent.data_source_id || page.parent.database_id);
    
  } catch (e) {
    console.error("Error retrieving specific page:", e.message);
  }
}
run();
