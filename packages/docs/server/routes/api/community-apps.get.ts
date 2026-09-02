import { defineEventHandler, setResponseHeaders } from "h3";

import { loadCommunityAppCatalog } from "../../lib/community-apps.server";

const COMMUNITY_APP_CACHE_CONTROL =
  "public, max-age=30, stale-while-revalidate=30, stale-if-error=300";

export default defineEventHandler(async (event) => {
  const catalog = await loadCommunityAppCatalog();
  setResponseHeaders(event, {
    "cache-control": COMMUNITY_APP_CACHE_CONTROL,
    "cdn-cache-control": COMMUNITY_APP_CACHE_CONTROL,
    "content-type": "application/json; charset=utf-8",
    "netlify-cdn-cache-control":
      "public, durable, s-maxage=30, stale-while-revalidate=30, stale-if-error=300",
  });
  return { apps: catalog.apps };
});
