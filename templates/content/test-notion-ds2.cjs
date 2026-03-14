const { Client } = require("@notionhq/client");
const notion = new Client({ auth: process.env.NOTION_API_KEY });
console.log(Object.keys(notion.dataSources || {}));
