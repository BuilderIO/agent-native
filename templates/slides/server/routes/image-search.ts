import { Request, Response } from "express";

export async function searchImages(req: Request, res: Response) {
  const { q } = req.query;
  if (!q || typeof q !== "string") {
    return res.status(400).json({ error: "Missing query parameter 'q'" });
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;

  if (!apiKey || !cx) {
    return res.status(500).json({
      error: "Google Search not configured. Set GOOGLE_API_KEY and GOOGLE_SEARCH_CX environment variables.",
    });
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

    const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
    if (!response.ok) {
      const text = await response.text();
      console.error("Google API error:", response.status, text);
      return res.status(response.status).json({ error: "Google API error" });
    }

    const data = await response.json();
    const results = (data.items || []).map((item: any) => ({
      url: item.link,
      thumbnail: item.image?.thumbnailLink || item.link,
      title: item.title,
      width: item.image?.width,
      height: item.image?.height,
    }));

    return res.json(results);
  } catch (err) {
    console.error("Image search error:", err);
    return res.status(500).json({ error: "Search failed" });
  }
}
