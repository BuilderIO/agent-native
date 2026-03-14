const { Client } = require("@notionhq/client");
const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function run() {
  try {
    const pageId = "3113d727-4be5-80be-936e-fcb875d6819d";
    const existingPage = await notion.pages.retrieve({ page_id: pageId });

    // Clean properties: remove id, computed fields, etc.
    const cleanProps = {};
    for (const [key, prop] of Object.entries(existingPage.properties)) {
      if (
        [
          "formula",
          "rollup",
          "created_by",
          "created_time",
          "last_edited_by",
          "last_edited_time",
        ].includes(prop.type)
      )
        continue;
      cleanProps[key] = { type: prop.type, [prop.type]: prop[prop.type] };
      if (prop.type === "select") {
        if (prop.select) cleanProps[key].select = { name: prop.select.name };
        else delete cleanProps[key].select;
      } else if (prop.type === "multi_select") {
        if (prop.multi_select)
          cleanProps[key].multi_select = prop.multi_select.map((s) => ({
            name: s.name,
          }));
      } else if (prop.type === "people") {
        if (prop.people)
          cleanProps[key].people = prop.people.map((p) => ({ id: p.id }));
      } else if (prop.type === "relation") {
        if (prop.relation)
          cleanProps[key].relation = prop.relation.map((r) => ({ id: r.id }));
      }
    }

    // Use the original database_id that we got from the parent of the retrieved page
    const response = await notion.pages.create({
      parent: { database_id: existingPage.parent.database_id },
      properties: cleanProps,
    });

    console.log("Successfully created new page:", response.id);
    await notion.pages.update({ page_id: response.id, archived: true });
  } catch (e) {
    console.error("Error:", e.message);
  }
}
run();
