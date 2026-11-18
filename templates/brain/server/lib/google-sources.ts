import { z } from "zod";

import {
  googleSourceScopeKey,
  parseGoogleSourceConfig,
  type GoogleSourceProvider,
} from "../../shared/google-source-config.js";
import type { schema } from "../db/index.js";
import type { createCapture } from "./brain.js";
import { requirePersonalGoogleConnection } from "./google-source-connection.js";
import { executeProviderApiRequest } from "./provider-api.js";

type Source = typeof schema.brainSources.$inferSelect;
type CaptureInput = Parameters<typeof createCapture>[0];
const cursorSchema = z.object({
  configKey: z.string().optional(),
  pageToken: z.string().optional(),
  windowStart: z.string().optional(),
  windowEnd: z.string().optional(),
});
const eventSchema = z.object({
  id: z.string().min(1),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  htmlLink: z.string().optional(),
  start: z
    .object({ dateTime: z.string().optional(), date: z.string().optional() })
    .optional(),
  end: z
    .object({ dateTime: z.string().optional(), date: z.string().optional() })
    .optional(),
  attendees: z
    .array(
      z.object({
        displayName: z.string().optional(),
        email: z.string().optional(),
        responseStatus: z.string().optional(),
      }),
    )
    .optional(),
});
interface MessagePart {
  mimeType?: string | undefined;
  filename?: string | undefined;
  body?: { data?: string | undefined } | undefined;
  parts?: MessagePart[] | undefined;
}
const partSchema: z.ZodType<MessagePart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  }),
);
const messageSchema = z.object({
  id: z.string().min(1),
  internalDate: z.string().regex(/^\d+$/).optional(),
  snippet: z.string().optional(),
  payload: z
    .object({
      headers: z
        .array(z.object({ name: z.string(), value: z.string() }))
        .optional(),
    })
    .and(partSchema)
    .optional(),
});
const fileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string(),
  modifiedTime: z.string().optional(),
  webViewLink: z.string().optional(),
  trashed: z.boolean().optional(),
});

class GoogleSourceTruncatedError extends Error {
  constructor() {
    super("Google source response was truncated at the size limit.");
    this.name = "GoogleSourceTruncatedError";
  }
}

export class GoogleSourceTransientError extends Error {
  readonly retryAfterMs = 60_000;
  constructor(status: number) {
    super(
      `Google source rate limit reached (HTTP ${status}); the sync will retry.`,
    );
    this.name = "GoogleSourceTransientError";
  }
}

function googleErrorReasons(json: unknown) {
  const parsed = z
    .object({
      error: z.object({
        errors: z.array(z.object({ reason: z.string() })).optional(),
      }),
    })
    .safeParse(json);
  return parsed.success
    ? (parsed.data.error.errors ?? []).map((error) => error.reason)
    : [];
}

function isGoogleFilePermissionDenied(response: {
  status: number;
  json?: unknown;
}) {
  if (response.status !== 403) return false;
  const reasons = googleErrorReasons(response.json);
  return (
    reasons.length > 0 &&
    reasons.every(
      (reason) =>
        reason === "insufficientFilePermissions" ||
        reason === "appNotAuthorizedToFile",
    )
  );
}

async function googleRequest(
  provider: GoogleSourceProvider,
  binding: { connectionId: string; accountId: string },
  path: string,
  query?: Record<string, unknown>,
) {
  const result = await executeProviderApiRequest({
    provider,
    method: "GET",
    path,
    query,
    ...binding,
    maxBytes: 1024 * 1024,
    timeoutMs: 30_000,
  });
  const envelope = z
    .object({
      response: z.object({
        ok: z.boolean(),
        status: z.number(),
        truncated: z.boolean(),
        json: z.unknown().optional(),
        text: z.string().nullable().optional(),
      }),
    })
    .parse(result);
  const quotaReasons = new Set([
    "rateLimitExceeded",
    "userRateLimitExceeded",
    "dailyLimitExceeded",
    "quotaExceeded",
  ]);
  if (
    envelope.response.status === 429 ||
    (envelope.response.status === 403 &&
      googleErrorReasons(envelope.response.json).some((reason) =>
        quotaReasons.has(reason),
      ))
  ) {
    throw new GoogleSourceTransientError(envelope.response.status);
  }
  if (envelope.response.truncated) {
    if (!envelope.response.ok)
      throw new Error(
        `Google source request failed (HTTP ${envelope.response.status}); its error response was truncated.`,
      );
    throw new GoogleSourceTruncatedError();
  }
  return envelope.response;
}

function requireSuccess(response: { ok: boolean; status: number }) {
  if (!response.ok)
    throw new Error(
      `Google source request failed (HTTP ${response.status}). Reconnect or check the source permissions.`,
    );
}

function plainMessageBody(part: MessagePart | undefined): string {
  if (!part) return "";
  if (part.filename) return "";
  if (part.mimeType === "text/plain" && part.body?.data)
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  return (part.parts ?? []).map(plainMessageBody).filter(Boolean).join("\n");
}

export async function readGoogleSourcePage(source: Source) {
  const provider = source.provider as GoogleSourceProvider;
  const rawConfig: unknown = JSON.parse(source.configJson);
  const config = z.record(z.string(), z.unknown()).parse(rawConfig);
  const options = parseGoogleSourceConfig(provider, config);
  const binding = await requirePersonalGoogleConnection(
    provider,
    config,
    source.ownerEmail,
  );
  const configKey = `${googleSourceScopeKey(provider, config)}:${binding.accountId}`;
  const previous = cursorSchema.parse(JSON.parse(source.cursorJson));
  const cursor = previous.configKey === configKey ? previous : {};
  const captures: CaptureInput[] = [];
  const inaccessibleExternalIds: string[] = [];
  const skippedItems: Array<{
    externalId: string;
    reason: "response_truncated";
  }> = [];
  let nextPageToken: string | undefined;
  let windowStart: string | undefined;
  let windowEnd: string | undefined;
  const capture = (
    input: Omit<CaptureInput, "sourceId" | "audience">,
  ): CaptureInput => ({
    ...input,
    sourceId: source.id,
    audience: {
      kind: "restricted",
      memberEmails: [binding.ownerEmail],
      upstreamRefHash: `${provider}:${binding.accountId}:${input.externalId}`,
    },
  });

  if (provider === "google_calendar") {
    const now = Date.now();
    windowStart =
      cursor.windowStart ??
      new Date(now - options.lookbackDays * 86_400_000).toISOString();
    windowEnd =
      cursor.windowEnd ??
      new Date(now + options.lookaheadDays * 86_400_000).toISOString();
    const response = await googleRequest(
      provider,
      binding,
      `/calendars/${encodeURIComponent(options.calendarId)}/events`,
      {
        singleEvents: true,
        showDeleted: true,
        maxResults: options.pageSize,
        timeMin: windowStart,
        timeMax: windowEnd,
        ...(cursor.pageToken ? { pageToken: cursor.pageToken } : {}),
      },
    );
    requireSuccess(response);
    const page = z
      .object({
        items: z.array(eventSchema).default([]),
        nextPageToken: z.string().optional(),
      })
      .parse(response.json);
    nextPageToken = page.nextPageToken;
    for (const event of page.items) {
      const externalId = `${provider}:${options.calendarId}:${event.id}`;
      if (event.status === "cancelled") {
        inaccessibleExternalIds.push(externalId);
        continue;
      }
      captures.push(
        capture({
          externalId,
          title: event.summary ?? "Calendar event",
          kind: "note",
          content: [
            event.summary,
            event.description,
            event.location,
            event.start?.dateTime ?? event.start?.date,
            event.end?.dateTime ?? event.end?.date,
            ...(event.attendees ?? []).map((person) =>
              [person.displayName, person.email, person.responseStatus]
                .filter(Boolean)
                .join(" "),
            ),
          ]
            .filter(Boolean)
            .join("\n"),
          capturedAt:
            event.start?.dateTime ??
            (event.start?.date
              ? `${event.start.date}T00:00:00.000Z`
              : new Date(now).toISOString()),
          metadata: {
            connector: provider,
            sourceUrl: event.htmlLink,
            calendarId: options.calendarId,
          },
        }),
      );
    }
  } else if (provider === "gmail") {
    const response = await googleRequest(
      provider,
      binding,
      "/users/me/messages",
      {
        q: options.query,
        maxResults: options.pageSize,
        ...(cursor.pageToken ? { pageToken: cursor.pageToken } : {}),
      },
    );
    requireSuccess(response);
    const page = z
      .object({
        messages: z.array(z.object({ id: z.string().min(1) })).default([]),
        nextPageToken: z.string().optional(),
      })
      .parse(response.json);
    nextPageToken = page.nextPageToken;
    for (const item of page.messages) {
      const externalId = `${provider}:${item.id}`;
      try {
        const detail = await googleRequest(
          provider,
          binding,
          `/users/me/messages/${encodeURIComponent(item.id)}`,
          { format: "full" },
        );
        if (detail.status === 404) {
          inaccessibleExternalIds.push(`${provider}:${item.id}`);
          continue;
        }
        requireSuccess(detail);
        const message = messageSchema.parse(detail.json);
        const subject =
          message.payload?.headers?.find(
            (header) => header.name.toLowerCase() === "subject",
          )?.value ?? "Email";
        const text = plainMessageBody(message.payload);
        captures.push(
          capture({
            externalId: `${provider}:${message.id}`,
            title: subject,
            kind: "message",
            content: [
              subject,
              ...(text
                ? []
                : ["[Partial email preview; full message body unavailable.]"]),
              text || message.snippet,
            ]
              .filter(Boolean)
              .join("\n\n"),
            capturedAt: message.internalDate
              ? new Date(Number(message.internalDate)).toISOString()
              : new Date().toISOString(),
            metadata: {
              connector: provider,
              sourceUrl: `https://mail.google.com/mail/u/${encodeURIComponent(binding.accountId)}/#all/${encodeURIComponent(message.id)}`,
              snippetOnly: !text,
            },
          }),
        );
      } catch (error) {
        if (!(error instanceof GoogleSourceTruncatedError)) throw error;
        skippedItems.push({ externalId, reason: "response_truncated" });
      }
    }
  } else {
    for (const fileId of options.fileIds) {
      const externalId = `${provider}:${fileId}`;
      try {
        const metadata = await googleRequest(
          provider,
          binding,
          `/files/${encodeURIComponent(fileId)}`,
          { fields: "id,name,mimeType,modifiedTime,webViewLink,trashed" },
        );
        if (metadata.status === 404 || isGoogleFilePermissionDenied(metadata)) {
          inaccessibleExternalIds.push(externalId);
          continue;
        }
        requireSuccess(metadata);
        const file = fileSchema.parse(metadata.json);
        if (file.trashed) {
          inaccessibleExternalIds.push(externalId);
          continue;
        }
        if (
          file.mimeType !== "application/vnd.google-apps.document" &&
          file.mimeType !== "text/plain" &&
          file.mimeType !== "text/markdown"
        ) {
          throw new Error(
            "Google Drive sources support Google Docs, plain-text, and Markdown files. Choose supported file IDs.",
          );
        }
        const body =
          file.mimeType === "application/vnd.google-apps.document"
            ? await googleRequest(
                provider,
                binding,
                `/files/${encodeURIComponent(fileId)}/export`,
                { mimeType: "text/plain" },
              )
            : await googleRequest(
                provider,
                binding,
                `/files/${encodeURIComponent(fileId)}`,
                { alt: "media" },
              );
        requireSuccess(body);
        if (typeof body.text !== "string")
          throw new Error("Google Drive did not return readable text.");
        captures.push(
          capture({
            externalId,
            title: file.name,
            kind: "document",
            content: body.text,
            capturedAt: file.modifiedTime ?? new Date().toISOString(),
            metadata: {
              connector: provider,
              sourceUrl:
                file.webViewLink ??
                `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`,
            },
          }),
        );
      } catch (error) {
        if (!(error instanceof GoogleSourceTruncatedError)) throw error;
        skippedItems.push({ externalId, reason: "response_truncated" });
      }
    }
  }
  return {
    captures,
    inaccessibleExternalIds,
    skippedItems,
    hasMore: Boolean(nextPageToken),
    startsCycle: !cursor.pageToken,
    cursor: {
      configKey,
      ...(nextPageToken
        ? { pageToken: nextPageToken, windowStart, windowEnd }
        : {}),
    },
  };
}
