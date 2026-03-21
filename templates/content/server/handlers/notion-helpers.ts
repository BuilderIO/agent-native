export function cleanNotionProperties(properties: any): any {
  const cleanProps: any = {};
  for (const [key, prop] of Object.entries(properties) as any[]) {
    // Skip read-only and un-settable properties
    if (
      [
        "formula",
        "rollup",
        "created_by",
        "created_time",
        "last_edited_by",
        "last_edited_time",
      ].includes(prop.type)
    ) {
      continue;
    }

    // Check if the property is completely empty to prevent "body failed validation" errors
    // specially for empty relations, people, dates etc
    if (
      prop.type === "relation" &&
      (!prop.relation || prop.relation.length === 0)
    )
      continue;
    if (prop.type === "people" && (!prop.people || prop.people.length === 0))
      continue;
    if (prop.type === "date" && !prop.date) continue;
    if (prop.type === "url" && !prop.url) continue;
    if (prop.type === "email" && !prop.email) continue;
    if (prop.type === "phone_number" && !prop.phone_number) continue;
    if (prop.type === "number" && prop.number === null) continue;
    if (
      prop.type === "rich_text" &&
      (!prop.rich_text || prop.rich_text.length === 0)
    )
      continue;

    cleanProps[key] = {
      type: prop.type,
      [prop.type]: prop[prop.type],
    };

    // Cleanup specific types that have nested structures Notion doesn't like on creation
    if (prop.type === "select") {
      if (prop.select) cleanProps[key].select = { name: prop.select.name };
      else delete cleanProps[key].select;
    } else if (prop.type === "multi_select") {
      if (prop.multi_select)
        cleanProps[key].multi_select = prop.multi_select.map((s: any) => ({
          name: s.name,
        }));
    } else if (prop.type === "people") {
      if (prop.people)
        cleanProps[key].people = prop.people.map((p: any) => ({ id: p.id }));
    } else if (prop.type === "relation") {
      if (prop.relation)
        cleanProps[key].relation = prop.relation.map((r: any) => ({
          id: r.id,
        }));
    } else if (prop.type === "title") {
      // title must exist and be valid
      if (!prop.title || prop.title.length === 0) {
        cleanProps[key].title = [{ text: { content: "Untitled" } }];
      }
    }
  }
  return cleanProps;
}
