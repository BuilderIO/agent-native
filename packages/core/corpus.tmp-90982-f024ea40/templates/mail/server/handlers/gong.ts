import { appStateGet } from "@agent-native/core/application-state";
import { getSession } from "@agent-native/core/server";
import {
  defineEventHandler,
  getQuery,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";

// POST /api/gong/validate — verify a key without saving it
export const gongValidate = defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event).catch(() => ({}));
  const apiKey = (body as { apiKey?: unknown })?.apiKey;
  if (!apiKey || typeof apiKey !== "string") {
    setResponseStatus(event, 400);
    return { valid: false, error: "apiKey is required" };
  }
  // Gong accepts either Bearer (access token) or Basic (accessKey:secret) auth
  const authHeaders = [
    `Bearer ${apiKey}`,
    `Basic ${Buffer.from(apiKey).toString("base64")}`,
  ];
  let lastStatus = 0;
  for (const auth of authHeaders) {
    try {
      const response = await fetch("https://api.gong.io/v2/users?limit=1", {
        headers: { Authorization: auth },
      });
      if (response.ok) return { valid: true };
      lastStatus = response.status;
      if (response.status !== 401 && response.status !== 403) break;
    } catch {
      setResponseStatus(event, 502);
      return { valid: false, error: "Could not reach Gong to verify the key." };
    }
  }
  if (lastStatus === 401 || lastStatus === 403) {
    setResponseStatus(event, lastStatus);
    return { valid: false, error: "Invalid Gong API key." };
  }
  setResponseStatus(event, lastStatus || 502);
  return {
    valid: false,
    error: lastStatus
      ? `Gong API returned ${lastStatus}.`
      : "Could not reach Gong to verify the key.",
  };
});

async function getSessionId(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session) return "local";
  return session.email;
}

async function getGongKey(event: H3Event): Promise<string | undefined> {
  const sessionId = await getSessionId(event);
  const data = await appStateGet(sessionId, "gong");
  return (data as any)?.apiKey || undefined;
}

// GET /api/gong/calls?email=...
export const gongCallsLookup = defineEventHandler(async (event: H3Event) => {
  const { email } = getQuery(event);
  if (!email || typeof email !== "string") {
    setResponseStatus(event, 400);
    return { error: "email query param required" };
  }

  const apiKey = await getGongKey(event);
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
