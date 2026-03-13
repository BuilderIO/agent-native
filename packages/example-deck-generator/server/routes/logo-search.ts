import { Request, Response } from "express";

const LOGO_DEV_PK = "pk_VwOyCAOgT0aBNpecT2qO-A";

/**
 * Logo config endpoint - returns client-side safe config
 * GET /api/logo/config
 */
export function logoConfig(_req: Request, res: Response) {
  res.json({
    brandfetchId: process.env.BRANDFETCH_CLIENT_ID || null,
    hasLogoDevSecret: !!(process.env.LOGO_DEV_SECRET_KEY?.startsWith("sk_")),
  });
}

/**
 * Logo search endpoint
 * GET /api/logo/search?q=intuit
 */
export async function searchLogos(req: Request, res: Response) {
  const q = (req.query.q as string || "").trim().toLowerCase();
  if (!q) {
    return res.status(400).json({ error: "Missing ?q= parameter" });
  }

  const secretKey = process.env.LOGO_DEV_SECRET_KEY;

  // If we have a secret key that's actually an sk_ key, use the search API
  if (secretKey && secretKey.startsWith("sk_")) {
    try {
      const response = await fetch(
        `https://api.logo.dev/search?q=${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${secretKey}` } },
      );

      if (response.ok) {
        const results: Array<{ name: string; domain: string }> = await response.json();
        return res.json(results.map((r) => ({ name: r.name, domain: r.domain })));
      }
    } catch {
      // Fall through to domain guessing
    }
  }

  // Domain guessing: generate candidate domains from the query
  const candidates: Array<{ name: string; domain: string }> = [];

  if (q.includes(".")) {
    const clean = q.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    candidates.push({ name: clean.split(".")[0], domain: clean });
  } else {
    const slug = q.replace(/[^a-z0-9]/g, "");
    const slugDashed = q.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const tlds = [".com", ".io", ".co", ".dev", ".org", ".net"];
    const seen = new Set<string>();

    for (const tld of tlds) {
      const domain = slug + tld;
      if (!seen.has(domain)) {
        seen.add(domain);
        candidates.push({ name: q, domain });
      }
    }

    if (slugDashed !== slug) {
      candidates.push({ name: q, domain: slugDashed + ".com" });
    }
  }

  res.json(candidates);
}
