const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  try {
    const pageId = '3113d727-4be5-80be-936e-fcb875d6819d';
    const existingPage = await notion.pages.retrieve({ page_id: pageId });
    
    // Clean properties: remove id, computed fields, etc.
    const cleanProps = {};
    for (const [key, prop] of Object.entries(existingPage.properties)) {
      // skip read-only property types
      if (['formula', 'rollup', 'created_by', 'created_time', 'last_edited_by', 'last_edited_time'].includes(prop.type)) {
        continue;
      }
      
      // copy over the structure needed for creation
      cleanProps[key] = {
        type: prop.type,
        [prop.type]: prop[prop.type]
      };
      
      // Some types need further cleanup
      if (prop.type === 'select' && prop.select) {
        cleanProps[key].select = { name: prop.select.name };
      } else if (prop.type === 'multi_select' && prop.multi_select) {
        cleanProps[key].multi_select = prop.multi_select.map(s => ({ name: s.name }));
      } else if (prop.type === 'people' && prop.people) {
         cleanProps[key].people = prop.people.map(p => ({ id: p.id }));
      } else if (prop.type === 'relation' && prop.relation) {
         cleanProps[key].relation = prop.relation.map(r => ({ id: r.id }));
      }
    }
    
    console.log("Cleaned props:", JSON.stringify(cleanProps, null, 2).slice(0, 500));

    // Try creating a new page
    const response = await notion.pages.create({
      parent: existingPage.parent,
      properties: cleanProps,
    });
    
    console.log("Successfully created new page:", response.id);
    
    // Cleanup: archive the newly created one so we don't mess up the DB
    await notion.pages.update({ page_id: response.id, archived: true });
    
  } catch (e) {
    console.error("Error:", e.message);
  }
}
run();
