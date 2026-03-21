import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
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
export const gongCallsLookup = defineEventHandler(async (event: H3Event) => {
  const { email } = getQuery(event);
  if (!email || typeof email !== "string") {
    setResponseStatus(event, 400);
    return { error: "email query param required" };
  }

  const apiKey = getGongKey();
  if (!apiKey) {
    setResponseStatus(event, 401);
    return { error: "Gong API key not configured" };
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
        setResponseStatus(event, response.status);
        return { error: `Gong API error: ${response.status}` };
      }
      const basicData = await basicRes.json();
      return filterCallsByEmail(basicData.calls || [], email);
    }

    const data = await response.json();
    return filterCallsByEmail(data.calls || [], email);
  } catch {
    setResponseStatus(event, 500);
    return { error: "Failed to reach Gong API" };
  }
});

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
