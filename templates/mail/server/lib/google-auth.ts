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

export function getAuthUrl(origin?: string): string {
  const redirectUri = origin
    ? `${origin}/api/google/callback`
    : undefined;
  const client = createOAuth2Client(redirectUri);
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function exchangeCode(
  code: string,
  origin?: string,
): Promise<void> {
  const redirectUri = origin
    ? `${origin}/api/google/callback`
    : undefined;
  const client = createOAuth2Client(redirectUri);
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
