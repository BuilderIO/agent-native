import { defineEventHandler, getQuery } from "h3";

import { buildNotionAuthUrl } from "../../../lib/notion.js";

export default defineEventHandler(async (event) => {
  const redirectPath = (getQuery(event).redirect as string) || "/";
  return { url: await buildNotionAuthUrl(event, redirectPath) };
});
