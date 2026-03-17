import type { Request, Response } from "express";
import fs from "fs";
import path from "path";

const STATE_DIR = path.join(process.cwd(), "application-state");
const GONG_FILE = path.join(STATE_DIR, "gong.json");

function getGongKey(): string | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(GONG_FILE, "utf-8"));
    return data.apiKey || undefined;
  } catch {
    return undefined;
  }
}

// GET /api/gong/calls?email=...
export async function gongCallsLookup(
  req: Request,
  res: Response,
): Promise<void> {
  const { email } = req.query;
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "email query param required" });
    return;
  }

  const apiKey = getGongKey();
  if (!apiKey) {
    res.status(401).json({ error: "Gong API key not configured" });
    return;
  }

  try {
    // Gong uses Basic auth with access key:secret or Bearer token
    const response = await fetch(
      "https://api.gong.io/v2/calls?fromDateTime=" +
        new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      // Try with basic auth format (accessKey:secretKey base64)
      const basicRes = await fetch(
        "https://api.gong.io/v2/calls?fromDateTime=" +
          new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        {
          headers: {
            Authorization: `Basic ${Buffer.from(apiKey).toString("base64")}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (!basicRes.ok) {
        res
          .status(response.status)
          .json({ error: `Gong API error: ${response.status}` });
        return;
      }
      const basicData = await basicRes.json();
      const calls = filterCallsByEmail(basicData.calls || [], email);
      res.json(calls);
      return;
    }

    const data = await response.json();
    const calls = filterCallsByEmail(data.calls || [], email);
    res.json(calls);
  } catch {
    res.status(500).json({ error: "Failed to reach Gong API" });
  }
}

function filterCallsByEmail(calls: any[], email: string) {
  const emailLower = email.toLowerCase();
  return calls
    .filter((call: any) => {
      const participants = call.parties || [];
      return participants.some(
        (p: any) => p.emailAddress?.toLowerCase() === emailLower,
      );
    })
    .slice(0, 10)
    .map((call: any) => ({
      id: call.id,
      title: call.title,
      started: call.started,
      duration: call.duration,
      direction: call.direction,
      parties: (call.parties || []).map((p: any) => ({
        name: p.name,
        email: p.emailAddress,
      })),
    }));
}
