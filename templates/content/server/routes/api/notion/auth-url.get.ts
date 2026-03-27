import { defineEventHandler, getQuery } from "h3";
import { buildNotionAuthUrl } from "../../../lib/notion.js";

export default defineEventHandler((event) => {
  const redirectPath = (getQuery(event).redirect as string) || "/";
  return { url: buildNotionAuthUrl(event, redirectPath) };
});
