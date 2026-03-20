import { defineEventHandler, getQuery, setResponseStatus } from "h3";

export const searchImages = defineEventHandler(async (event) => {
  const query = getQuery(event);
  const q = query.q;
  if (!q || typeof q !== "string") {
    setResponseStatus(event, 400);
    return { error: "Missing query parameter 'q'" };
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;

  if (!apiKey || !cx) {
    setResponseStatus(event, 500);
    return {
      error:
        "Google Search not configured. Set GOOGLE_API_KEY and GOOGLE_SEARCH_CX environment variables.",
    };
  }

  try {
    const params = new URLSearchParams({
      key: apiKey,
      cx,
      q: q,
      searchType: "image",
      num: "10",
      safe: "active",
    });

    const response = await fetch(
      `https://www.googleapis.com/customsearch/v1?${params}`,
    );
    if (!response.ok) {
      const text = await response.text();
      console.error("Google API error:", response.status, text);
      setResponseStatus(event, response.status);
      return { error: "Google API error" };
    }

    const data = await response.json();
    const results = (data.items || []).map((item: any) => ({
      url: item.link,
      thumbnail: item.image?.thumbnailLink || item.link,
      title: item.title,
      width: item.image?.width,
      height: item.image?.height,
    }));

    return results;
  } catch (err) {
    console.error("Image search error:", err);
    setResponseStatus(event, 500);
    return { error: "Search failed" };
  }
});
