import { google } from "googleapis";
import path from "path";
import { readJsonFile, writeJsonFile, deleteJsonFile } from "./data-helpers.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

const TOKENS_PATH = path.join(process.cwd(), "data", "google-auth.json");

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

function createOAuth2Client(redirectUri?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment",
    );
  }
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri ?? "http://localhost:8080/api/google/callback",
  );
}

export function getAuthUrl(origin?: string, redirectUri?: string): string {
  const uri =
    redirectUri || (origin ? `${origin}/api/google/callback` : undefined);
  const client = createOAuth2Client(uri);
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function exchangeCode(
  code: string,
  origin?: string,
  redirectUri?: string,
): Promise<void> {
  const uri =
    redirectUri || (origin ? `${origin}/api/google/callback` : undefined);
  const client = createOAuth2Client(uri);
  const { tokens } = await client.getToken(code);
  writeJsonFile(TOKENS_PATH, tokens);
}

export async function getClient() {
  const tokens = readJsonFile<GoogleTokens>(TOKENS_PATH);
  if (!tokens) return null;

  const client = createOAuth2Client();
  client.setCredentials(tokens);

  client.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    writeJsonFile(TOKENS_PATH, merged);
  });

  return client;
}

export interface GoogleAuthStatus {
  connected: boolean;
  email?: string;
  expiresAt?: string;
}

export async function getAuthStatus(): Promise<GoogleAuthStatus> {
  const tokens = readJsonFile<GoogleTokens>(TOKENS_PATH);
  if (!tokens) {
    return { connected: false };
  }

  return {
    connected: true,
    expiresAt: tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : undefined,
  };
}

export function disconnect(): void {
  deleteJsonFile(TOKENS_PATH);
}

export function isConnected(): boolean {
  const tokens = readJsonFile<GoogleTokens>(TOKENS_PATH);
  return !!tokens;
}

export async function listGmailMessages(
  query?: string,
  maxResults = 50,
): Promise<any[]> {
  const client = await getClient();
  if (!client) return [];

  const gmail = google.gmail({ version: "v1", auth: client });
  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: query || "in:inbox",
    maxResults,
  });

  const messageIds = listRes.data.messages || [];
  if (messageIds.length === 0) return [];

  // Fetch full message details in parallel
  const messages = await Promise.all(
    messageIds.map(async (m) => {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: m.id!,
        format: "full",
      });
      return msg.data;
    }),
  );

  return messages;
}

function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string {
  return (
    headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ||
    ""
  );
}

function parseEmailAddress(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: raw, email: raw };
}

function parseAddressList(raw: string): Array<{ name: string; email: string }> {
  if (!raw) return [];
  return raw.split(",").map((a) => parseEmailAddress(a.trim()));
}

function getBody(payload: any): string {
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  if (payload.parts) {
    // Prefer text/plain, fallback to text/html
    const textPart = payload.parts.find(
      (p: any) => p.mimeType === "text/plain",
    );
    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
    const part = textPart || htmlPart;
    if (part?.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    // Recurse into multipart
    for (const p of payload.parts) {
      const body = getBody(p);
      if (body) return body;
    }
  }
  return "";
}

export function gmailToEmailMessage(msg: any): any {
  const headers = msg.payload?.headers || [];
  const from = parseEmailAddress(getHeader(headers, "From"));
  const to = parseAddressList(getHeader(headers, "To"));
  const cc = parseAddressList(getHeader(headers, "Cc"));
  const subject = getHeader(headers, "Subject");
  const date = getHeader(headers, "Date");
  const labels: string[] = msg.labelIds || [];

  return {
    id: msg.id,
    threadId: msg.threadId,
    from,
    to,
    cc: cc.length > 0 ? cc : undefined,
    subject,
    snippet: msg.snippet || "",
    body: getBody(msg.payload || {}),
    date: new Date(date).toISOString(),
    isRead: !labels.includes("UNREAD"),
    isStarred: labels.includes("STARRED"),
    isDraft: labels.includes("DRAFT"),
    isSent: labels.includes("SENT"),
    isArchived:
      !labels.includes("INBOX") &&
      !labels.includes("DRAFT") &&
      !labels.includes("SENT") &&
      !labels.includes("TRASH"),
    isTrashed: labels.includes("TRASH"),
    labelIds: labels
      .filter(
        (l: string) =>
          ![
            "UNREAD",
            "STARRED",
            "IMPORTANT",
            "CATEGORY_PERSONAL",
            "CATEGORY_SOCIAL",
            "CATEGORY_UPDATES",
            "CATEGORY_PROMOTIONS",
            "CATEGORY_FORUMS",
          ].includes(l),
      )
      .map((l: string) => l.toLowerCase()),
  };
}
