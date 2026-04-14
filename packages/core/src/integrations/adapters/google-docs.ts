import type { H3Event } from "h3";
import type {
  PlatformAdapter,
  IncomingMessage,
  OutgoingMessage,
  IntegrationStatus,
} from "../types.js";
import type { EnvKeyConfig } from "../../server/create-server.js";

/** Google Docs comment replies have no formal length limit but keep it reasonable */
const GDOCS_MAX_LENGTH = 4000;

// ─── Service Account Auth ───────────────────────────────────────────────────

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Parse the service account key from env.
 * Supports both a JSON string and a file path.
 */
export function getServiceAccountKey(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceAccountKey;
  } catch {
    // Could be a file path — try reading it
    try {
      const fs = require("node:fs");
      const content = fs.readFileSync(raw, "utf-8");
      return JSON.parse(content) as ServiceAccountKey;
    } catch {
      return null;
    }
  }
}

/**
 * Get the service account email for display (users share docs with this).
 */
export function getServiceAccountEmail(): string | null {
  const key = getServiceAccountKey();
  return key?.client_email ?? null;
}

/**
 * Create a signed JWT and exchange it for an access token.
 */
export async function getServiceAccountAccessToken(): Promise<string | null> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const key = getServiceAccountKey();
  if (!key) return null;

  try {
    const crypto = await import("node:crypto");

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iss: key.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: key.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };

    const encode = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj)).toString("base64url");

    const unsigned = `${encode(header)}.${encode(payload)}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(unsigned);
    const signature = signer.sign(key.private_key, "base64url");
    const jwt = `${unsigned}.${signature}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[google-docs] Token exchange failed:", err);
      return null;
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
  } catch (err) {
    console.error("[google-docs] Failed to get service account token:", err);
    return null;
  }
}

// ─── Google Drive API Helpers ───────────────────────────────────────────────

/**
 * Extract a Google Doc file ID from a URL or return the string as-is.
 */
export function extractFileId(urlOrId: string): string {
  const match = urlOrId.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : urlOrId;
}

export interface GoogleDocComment {
  id: string;
  content: string;
  author: { displayName: string; emailAddress?: string };
  createdTime: string;
  modifiedTime: string;
  resolved: boolean;
  quotedFileContent?: { value: string };
  replies?: Array<{
    id: string;
    content: string;
    author: { displayName: string; emailAddress?: string };
    createdTime: string;
  }>;
}

/**
 * List comments on a Google Doc, optionally filtering by modified time.
 */
export async function listDocComments(
  fileId: string,
  accessToken: string,
  startModifiedTime?: string,
): Promise<GoogleDocComment[]> {
  const params = new URLSearchParams({
    fields:
      "comments(id,content,author,createdTime,modifiedTime,resolved,quotedFileContent,replies(id,content,author,createdTime))",
    pageSize: "100",
  });
  if (startModifiedTime) {
    params.set("startModifiedTime", startModifiedTime);
  }

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/comments?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to list comments: ${err}`);
  }
  const data = (await res.json()) as { comments?: GoogleDocComment[] };
  return data.comments ?? [];
}

/**
 * Reply to a comment on a Google Doc.
 */
export async function replyToComment(
  fileId: string,
  commentId: string,
  content: string,
  accessToken: string,
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/comments/${commentId}/replies`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        fields: "id",
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to reply to comment: ${err}`);
  }
}

/**
 * Get the start page token for changes.list (initial sync point).
 */
export async function getStartPageToken(accessToken: string): Promise<string> {
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/changes/startPageToken",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error("Failed to get start page token");
  const data = (await res.json()) as { startPageToken: string };
  return data.startPageToken;
}

export interface DriveChange {
  fileId: string;
  removed: boolean;
  file?: {
    id: string;
    name: string;
    mimeType: string;
  };
}

/**
 * List changes since a page token. Returns changed file IDs and the next token.
 */
export async function listChanges(
  pageToken: string,
  accessToken: string,
): Promise<{ changes: DriveChange[]; nextPageToken: string }> {
  const params = new URLSearchParams({
    pageToken,
    fields:
      "nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType))",
    pageSize: "100",
    includeRemoved: "false",
  });

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/changes?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to list changes: ${err}`);
  }
  const data = (await res.json()) as {
    changes?: DriveChange[];
    nextPageToken?: string;
    newStartPageToken?: string;
  };
  return {
    changes: data.changes ?? [],
    nextPageToken: data.nextPageToken || data.newStartPageToken || pageToken,
  };
}

// ─── Platform Adapter ───────────────────────────────────────────────────────

/**
 * Create a Google Docs platform adapter.
 *
 * Unlike Slack/Telegram, this adapter is poll-driven — the poller
 * constructs IncomingMessage objects and feeds them through the
 * webhook handler. The adapter handles formatting and sending replies.
 *
 * Setup:
 * - Set GOOGLE_SERVICE_ACCOUNT_KEY (JSON string or file path) in env
 * - Users share their Google Docs with the service account email
 * - Comments containing the trigger keyword (default: "@agent") are processed
 */
export function googleDocsAdapter(): PlatformAdapter {
  return {
    platform: "google-docs",
    label: "Google Docs",

    getRequiredEnvKeys(): EnvKeyConfig[] {
      return [
        {
          key: "GOOGLE_SERVICE_ACCOUNT_KEY",
          label: "Google Service Account Key (JSON)",
          required: true,
        },
      ];
    },

    async handleVerification(
      _event: H3Event,
    ): Promise<{ handled: boolean; response?: unknown }> {
      return { handled: false };
    },

    async verifyWebhook(_event: H3Event): Promise<boolean> {
      return true;
    },

    async parseIncomingMessage(
      _event: H3Event,
    ): Promise<IncomingMessage | null> {
      return null;
    },

    async sendResponse(
      message: OutgoingMessage,
      context: IncomingMessage,
    ): Promise<void> {
      const fileId = context.platformContext.fileId as string;
      const commentId = context.platformContext.commentId as string;

      const accessToken = await getServiceAccountAccessToken();
      if (!accessToken) {
        console.error("[google-docs] No access token available to send reply");
        return;
      }

      const chunks = splitMessage(message.text, GDOCS_MAX_LENGTH);
      for (const chunk of chunks) {
        try {
          await replyToComment(fileId, commentId, chunk, accessToken);
        } catch (err) {
          console.error("[google-docs] Failed to send reply:", err);
        }
      }
    },

    formatAgentResponse(text: string): OutgoingMessage {
      return { text, platformContext: {} };
    },

    async getStatus(_baseUrl?: string): Promise<IntegrationStatus> {
      const key = getServiceAccountKey();
      const configured = !!key;
      const email = key?.client_email;

      return {
        platform: "google-docs",
        label: "Google Docs",
        enabled: false,
        configured,
        details: {
          serviceAccountEmail: email,
        },
        error: !configured
          ? "Set GOOGLE_SERVICE_ACCOUNT_KEY in your environment (JSON string or file path to the key file)"
          : undefined,
      };
    },
  };
}

/** Split a message into chunks that fit within the platform's limit */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx <= 0) splitIdx = remaining.lastIndexOf(" ", maxLength);
    if (splitIdx <= 0) splitIdx = maxLength;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}
