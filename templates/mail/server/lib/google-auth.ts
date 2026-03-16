import { google, type Auth } from "googleapis";
import fs from "fs";
import path from "path";
import { readJsonFile, writeJsonFile, deleteJsonFile } from "./data-helpers.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

const ACCOUNTS_DIR = path.join(process.cwd(), "data", "google-accounts");
const LEGACY_TOKENS_PATH = path.join(process.cwd(), "data", "google-auth.json");

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

function ensureAccountsDir(): void {
  fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
}

function getAccountFiles(): string[] {
  ensureAccountsDir();
  try {
    return fs
      .readdirSync(ACCOUNTS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(ACCOUNTS_DIR, f));
  } catch {
    return [];
  }
}

/**
 * Migrate legacy single-token file to multi-account format.
 * Uses a module-level promise to ensure only one migration runs at a time.
 */
let migrationPromise: Promise<void> | null = null;

async function migrateLegacyTokens(): Promise<void> {
  if (!fs.existsSync(LEGACY_TOKENS_PATH)) return;
  if (!migrationPromise) {
    migrationPromise = doMigrateLegacyTokens().finally(() => {
      migrationPromise = null;
    });
  }
  return migrationPromise;
}

async function doMigrateLegacyTokens(): Promise<void> {
  const tokens = readJsonFile<GoogleTokens>(LEGACY_TOKENS_PATH);
  if (!tokens) {
    // Corrupt/empty file — delete so we don't retry on every request
    deleteJsonFile(LEGACY_TOKENS_PATH);
    return;
  }

  ensureAccountsDir();

  try {
    const client = createOAuth2Client();
    client.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: client });
    const profile = await gmail.users.getProfile({ userId: "me" });
    const email = profile.data.emailAddress;
    if (email) {
      writeJsonFile(path.join(ACCOUNTS_DIR, `${email}.json`), tokens);
    } else {
      // Fallback: save as unknown
      writeJsonFile(path.join(ACCOUNTS_DIR, "unknown-account.json"), tokens);
    }
  } catch {
    // If we can't reach Gmail (offline, expired), just move with a fallback name
    writeJsonFile(path.join(ACCOUNTS_DIR, "migrated-account.json"), tokens);
  }

  deleteJsonFile(LEGACY_TOKENS_PATH);
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
): Promise<string> {
  const uri =
    redirectUri || (origin ? `${origin}/api/google/callback` : undefined);
  const client = createOAuth2Client(uri);
  const { tokens } = await client.getToken(code);

  // Determine the email address for this account
  client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress;
  if (!email) throw new Error("Google returned no email address");

  ensureAccountsDir();
  writeJsonFile(path.join(ACCOUNTS_DIR, `${email}.json`), tokens);

  return email;
}

export async function getClient(
  email?: string,
): Promise<Auth.OAuth2Client | null> {
  await migrateLegacyTokens();

  const files = getAccountFiles();
  if (files.length === 0) return null;

  let tokenFile: string | undefined;
  if (email) {
    tokenFile = files.find((f) => path.basename(f, ".json") === email);
    if (!tokenFile) return null;
  } else {
    tokenFile = files[0];
  }

  const tokens = readJsonFile<GoogleTokens>(tokenFile);
  if (!tokens) return null;

  const client = createOAuth2Client();
  client.setCredentials(tokens);

  client.on("tokens", (newTokens) => {
    const current = readJsonFile<GoogleTokens>(tokenFile) ?? {};
    writeJsonFile(tokenFile, { ...current, ...newTokens });
  });

  return client;
}

export async function getClients(): Promise<
  Array<{ email: string; client: Auth.OAuth2Client }>
> {
  await migrateLegacyTokens();

  const files = getAccountFiles();
  const results: Array<{ email: string; client: Auth.OAuth2Client }> = [];

  for (const file of files) {
    const tokens = readJsonFile<GoogleTokens>(file);
    if (!tokens) continue;

    const email = path.basename(file, ".json");
    const client = createOAuth2Client();
    client.setCredentials(tokens);

    client.on("tokens", (newTokens) => {
      const current = readJsonFile<GoogleTokens>(file) ?? {};
      writeJsonFile(file, { ...current, ...newTokens });
    });

    results.push({ email, client });
  }

  return results;
}

export function isConnected(): boolean {
  // Check for legacy file first (will be migrated on next getClient/getClients call)
  if (fs.existsSync(LEGACY_TOKENS_PATH)) return true;

  const files = getAccountFiles();
  return files.length > 0;
}

export function getConnectedAccounts(): string[] {
  const files = getAccountFiles();
  return files.map((f) => path.basename(f, ".json"));
}

export interface GoogleAuthStatus {
  connected: boolean;
  accounts: Array<{ email: string; expiresAt?: string }>;
}

export async function getAuthStatus(): Promise<GoogleAuthStatus> {
  await migrateLegacyTokens();

  const files = getAccountFiles();
  if (files.length === 0) {
    return { connected: false, accounts: [] };
  }

  const accounts: Array<{ email: string; expiresAt?: string }> = [];
  for (const file of files) {
    const tokens = readJsonFile<GoogleTokens>(file);
    if (!tokens) continue;
    const email = path.basename(file, ".json");
    accounts.push({
      email,
      expiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : undefined,
    });
  }

  return {
    connected: accounts.length > 0,
    accounts,
  };
}

export function disconnect(email?: string): void {
  if (email) {
    // Validate against known account files to prevent path traversal
    const files = getAccountFiles();
    const match = files.find((f) => path.basename(f, ".json") === email);
    if (match) deleteJsonFile(match);
  } else {
    const files = getAccountFiles();
    for (const file of files) {
      deleteJsonFile(file);
    }
  }
}

export async function listGmailMessages(
  query?: string,
  maxResults = 50,
): Promise<any[]> {
  const clients = await getClients();
  if (clients.length === 0) return [];

  // Fetch from all accounts in parallel
  const allResults = await Promise.all(
    clients.map(async ({ email, client }) => {
      try {
        const gmail = google.gmail({ version: "v1", auth: client });
        const listRes = await gmail.users.messages.list({
          userId: "me",
          q: query || "in:inbox",
          maxResults,
        });

        const messageIds = listRes.data.messages || [];
        if (messageIds.length === 0) return [];

        const messages = await Promise.all(
          messageIds.map(async (m) => {
            const msg = await gmail.users.messages.get({
              userId: "me",
              id: m.id!,
              format: "full",
            });
            return { ...msg.data, _accountEmail: email };
          }),
        );

        return messages;
      } catch (error: any) {
        console.error(
          `[listGmailMessages] Error fetching from ${email}:`,
          error.message,
        );
        return [];
      }
    }),
  );

  return allResults.flat();
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

export function gmailToEmailMessage(msg: any, accountEmail?: string): any {
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
    accountEmail: accountEmail || msg._accountEmail,
  };
}
