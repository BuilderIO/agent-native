import { defineAction } from "@agent-native/core";
import { resolveCredential } from "@agent-native/core/credentials";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { readAppSecret } from "@agent-native/core/secrets";
import {
  buildDeepLink,
  getCredentialContext,
  getRequestUserEmail,
  resolveHasBuilderPrivateKey,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { transcribeWithBuilder } from "@agent-native/core/transcription/builder";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import "../server/db/index.js";
import updateDocument from "./update-document.js";
import {
  assertAudioHasAudibleSignal,
  prepareAudioOnlyTranscriptionMedia,
  type AudioOnlyTranscriptionMedia,
} from "./lib/audio-only-transcription.js";

type MediaType = "audio" | "video";

interface SpeechToTextResponse {
  text?: string;
}

const BUILDER_GEMINI_TRANSCRIPTION_MODEL = "gemini-3-1-flash-lite";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";
const SPEECH_ONLY_TRANSCRIPTION_INSTRUCTIONS =
  "Transcribe only words spoken in the audio. Do not describe screen activity, UI changes, silence, music, or non-speech sounds. Return an empty transcript when there are no spoken words.";
const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

function mediaFallbackMimeType(mediaType: MediaType): string {
  return mediaType === "audio" ? "audio/webm" : "video/mp4";
}

function pickSourceMimeType(
  actual: string | null | undefined,
  fallback: string,
): string {
  const base = (actual ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!base || base === "application/octet-stream") return fallback;
  return actual ?? fallback;
}

function resolveMediaUrl(mediaUrl: string): string {
  if (!mediaUrl.startsWith("/")) return mediaUrl;
  const port = process.env.NITRO_PORT || process.env.PORT || "3000";
  const origin =
    process.env.PUBLIC_URL ??
    process.env.NITRO_PUBLIC_URL ??
    `http://localhost:${port}`;
  return `${origin}${mediaUrl}`;
}

function isRelativeMediaUrl(mediaUrl: string): boolean {
  return mediaUrl.startsWith("/") && !mediaUrl.startsWith("//");
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    BLOCKED_HOSTNAMES.has(normalized) ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:")
  ) {
    const mappedIpv4 = normalized.replace("::ffff:", "");
    return mappedIpv4.includes(".") ? isPrivateIpv4(mappedIpv4) : true;
  }

  const firstHextet = Number.parseInt(normalized.split(":")[0] || "0", 16);
  if (!Number.isFinite(firstHextet)) return true;
  return (firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80;
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

async function assertSafeRemoteMediaUrl(mediaUrl: string) {
  if (isRelativeMediaUrl(mediaUrl)) return;

  let parsed: URL;
  try {
    parsed = new URL(mediaUrl);
  } catch {
    throw new Error("Media URL must be a valid URL or app-relative path.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Media URL must use http or https.");
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new Error("Media URL cannot target a private or local host.");
  }

  const directIpFamily = isIP(parsed.hostname);
  const addresses = directIpFamily
    ? [parsed.hostname]
    : (await lookup(parsed.hostname, { all: true })).map(
        (entry) => entry.address,
      );

  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new Error("Media URL cannot resolve to a private or local address.");
  }
}

async function loadMediaBlob({
  mediaUrl,
  mediaType,
}: {
  mediaUrl: string;
  mediaType: MediaType;
}): Promise<{ blob: Blob; sourceMimeType: string }> {
  await assertSafeRemoteMediaUrl(mediaUrl);
  const resolvedUrl = resolveMediaUrl(mediaUrl);
  const response = isRelativeMediaUrl(mediaUrl)
    ? await fetch(resolvedUrl, { signal: AbortSignal.timeout(30_000) })
    : await ssrfSafeFetch(
        resolvedUrl,
        { signal: AbortSignal.timeout(30_000) },
        { maxRedirects: 3 },
      );
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${mediaType} media: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const blob = await response.blob();
  const contentType = response.headers.get("content-type");
  return {
    blob,
    sourceMimeType: pickSourceMimeType(
      contentType || blob.type,
      mediaFallbackMimeType(mediaType),
    ),
  };
}

function normalizeTranscriptText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function indentMarkdown(value: string): string {
  return value
    .split("\n")
    .map((line) => (line.trim() ? `\t${line}` : ""))
    .join("\n");
}

function transcriptToggleMarkdown(transcript: string): string {
  return `<details open>
<summary>Transcript</summary>
${indentMarkdown(transcript)}
</details>`;
}

function findMediaBlock(
  content: string,
  mediaUrl: string,
  mediaType: MediaType,
) {
  const srcValues = Array.from(
    new Set([mediaUrl, escapeHtmlAttribute(mediaUrl)]),
  );
  for (const src of srcValues) {
    const pattern = new RegExp(
      `<${mediaType}\\b[^>]*\\bsrc=["']${escapeRegExp(src)}["'][^>]*>\\s*</${mediaType}>`,
    );
    const match = content.match(pattern);
    if (match?.index !== undefined) {
      return {
        index: match.index,
        text: match[0],
      };
    }
  }
  return null;
}

function assertMediaUrlInDocument({
  content,
  mediaUrl,
  mediaType,
}: {
  content: string;
  mediaUrl: string;
  mediaType: MediaType;
}) {
  if (findMediaBlock(content, mediaUrl, mediaType)) return;
  throw new Error("Could not find that media URL in the document content.");
}

function insertTranscriptAfterMedia({
  content,
  mediaUrl,
  mediaType,
  transcript,
}: {
  content: string;
  mediaUrl: string;
  mediaType: MediaType;
  transcript: string;
}): string | null {
  const block = findMediaBlock(content, mediaUrl, mediaType);
  if (!block) return null;
  const insertAt = block.index + block.text.length;
  return `${content.slice(0, insertAt)}\n\n${transcriptToggleMarkdown(transcript)}${content.slice(insertAt)}`;
}

async function resolveKey(key: string): Promise<string | undefined> {
  const userEmail = getRequestUserEmail();
  if (userEmail) {
    const userSecret = await readAppSecret({
      key,
      scope: "user",
      scopeId: userEmail,
    }).catch(() => null);
    if (userSecret?.value) return userSecret.value;
  }

  const credCtx = getCredentialContext();
  if (!credCtx) return undefined;
  return (await resolveCredential(key, credCtx)) ?? undefined;
}

async function transcribeWithGroq(
  media: AudioOnlyTranscriptionMedia,
): Promise<string> {
  const apiKey = await resolveKey("GROQ_API_KEY");
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const form = new FormData();
  const body = media.audioBytes.buffer.slice(
    media.audioBytes.byteOffset,
    media.audioBytes.byteOffset + media.audioBytes.byteLength,
  ) as ArrayBuffer;
  form.append(
    "file",
    new Blob([body], { type: media.mimeType }),
    media.filename,
  );
  form.append("model", GROQ_MODEL);
  form.append("response_format", "json");
  form.append("temperature", "0");

  const response = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Groq transcription failed (${response.status} ${response.statusText}): ${text}`,
    );
  }

  const json = (await response.json()) as SpeechToTextResponse;
  return json.text ?? "";
}

async function transcribeMedia(media: AudioOnlyTranscriptionMedia) {
  let builderError: string | null = null;
  if (await resolveHasBuilderPrivateKey()) {
    try {
      const result = await transcribeWithBuilder({
        audioBytes: media.audioBytes,
        mimeType: media.mimeType,
        model: BUILDER_GEMINI_TRANSCRIPTION_MODEL,
        diarize: false,
        instructions: SPEECH_ONLY_TRANSCRIPTION_INSTRUCTIONS,
      });
      return {
        provider: "builder" as const,
        text: result.text,
      };
    } catch (err) {
      builderError = err instanceof Error ? err.message : String(err);
    }
  }

  try {
    return {
      provider: "groq" as const,
      text: await transcribeWithGroq(media),
    };
  } catch (err) {
    const groqError = err instanceof Error ? err.message : String(err);
    if (builderError) {
      throw new Error(
        `Builder transcription failed: ${builderError}. Groq fallback failed: ${groqError}`,
      );
    }
    throw new Error(
      `No media transcription provider is available. Connect Builder.io in Settings -> File uploads or configure GROQ_API_KEY. ${groqError}`,
    );
  }
}

async function applyTranscriptToDocument({
  documentId,
  mediaUrl,
  mediaType,
  placeholderText,
  transcript,
}: {
  documentId: string;
  mediaUrl: string;
  mediaType: MediaType;
  placeholderText?: string;
  transcript: string;
}): Promise<{ sqlUpdated: boolean; collabUpdated: boolean }> {
  const freshAccess = await assertAccess("document", documentId, "editor");
  const freshDoc = freshAccess.resource;

  const content = freshDoc.content ?? "";
  let nextContent: string | null = null;

  // Replace the placeholder if present; otherwise insert after the media block.
  // The transcript reaches the live editor through the normal change-sync:
  // update-document bumps updatedAt and the open editor reconciles the newer
  // content into the Y.Doc (see the `real-time-collab` skill). No localhost
  // collab push — that silently no-oped on serverless.
  if (placeholderText && content.includes(placeholderText)) {
    nextContent = content.replace(placeholderText, transcript);
  } else {
    nextContent = insertTranscriptAfterMedia({
      content,
      mediaUrl,
      mediaType,
      transcript,
    });
  }

  if (nextContent && nextContent !== content) {
    await updateDocument.run({ id: documentId, content: nextContent });
    return { sqlUpdated: true, collabUpdated: false };
  }

  throw new Error(
    placeholderText
      ? "Could not find the transcript placeholder in the document."
      : "Could not find the media block in the document.",
  );
}

export default defineAction({
  description:
    "Transcribe an audio or video media block in a Content document, then place the transcript in the transcript toggle beneath that media block.",
  schema: z.object({
    documentId: z.string().describe("Document ID containing the media block"),
    mediaUrl: z.string().describe("Audio or video URL to transcribe"),
    mediaType: z
      .enum(["audio", "video"])
      .describe("Type of media source: audio or video"),
    placeholderText: z
      .string()
      .optional()
      .describe(
        "Exact placeholder text inside the already-created Transcript toggle. When provided, this action replaces it with the transcript.",
      ),
  }),
  run: async ({ documentId, mediaUrl, mediaType, placeholderText }) => {
    const access = await assertAccess("document", documentId, "editor");
    assertMediaUrlInDocument({
      content: (access.resource.content as string | null) ?? "",
      mediaUrl,
      mediaType,
    });

    const mediaBlob = await loadMediaBlob({ mediaUrl, mediaType });
    const audioMedia = await prepareAudioOnlyTranscriptionMedia({
      blob: mediaBlob.blob,
      mediaId: documentId,
      sourceMimeType: mediaBlob.sourceMimeType,
    });
    await assertAudioHasAudibleSignal(audioMedia);

    const result = await transcribeMedia(audioMedia);
    const transcript = normalizeTranscriptText(result.text);
    if (!transcript) {
      throw new Error("No spoken words were detected in this media.");
    }

    const applyResult = await applyTranscriptToDocument({
      documentId,
      mediaUrl,
      mediaType,
      placeholderText,
      transcript,
    });

    return {
      documentId,
      mediaType,
      provider: result.provider,
      transcriptInserted: true,
      transcriptLength: transcript.length,
      transcriptWordCount: countWords(transcript),
      ...applyResult,
      deepLink: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId },
      }),
    };
  },
  link: ({ result }) => {
    const id = (result as { documentId?: string } | null)?.documentId;
    if (!id) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId: id },
      }),
      label: "Open document",
      view: "editor",
    };
  },
});
