import type { Request, Response } from "express";
import fs from "fs";
import path from "path";

const SETTINGS_FILE = path.join(process.cwd(), "data", "settings.json");

function getApolloKey(): string | undefined {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    return settings.apolloApiKey;
  } catch {
    return undefined;
  }
}

export async function apolloPersonLookup(req: Request, res: Response) {
  const { email } = req.query;
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "email query param required" });
    return;
  }

  const apiKey = getApolloKey();
  if (!apiKey) {
    res.status(401).json({ error: "Apollo API key not configured" });
    return;
  }

  try {
    const response = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      res
        .status(response.status)
        .json({ error: `Apollo API error: ${response.status}` });
      return;
    }

    const data = await response.json();
    res.json(data.person || null);
  } catch (err) {
    res.status(500).json({ error: "Failed to reach Apollo API" });
  }
}
