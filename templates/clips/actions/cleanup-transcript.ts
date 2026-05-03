/**
 * Shared Gemini cleanup pass for raw native transcripts.
 *
 * This action is the ONE narrow exception to the "all AI through agent chat"
 * rule (see CLAUDE.md rule 1 + 2). It is a media-pipeline path — input is a
 * transcript blob, output is structured cleanup. Same shape as
 * `transcribe-voice.ts`: server-side LLM call with no agent loop, no tools,
 * no chat sidebar.
 *
 * Used by:
 *   - Dictate dictation finalize (task='cleanup')
 *   - Clips finalize (task='title' / 'cleanup')
 *   - Meetings finalize (task='summary' → summary + bullets + action items)
 *
 * Provider routing:
 *   1. resolveBuilderCredential('BUILDER_PRIVATE_KEY') → Builder gateway
 *      with model `gemini-3-1-flash-lite` (matches existing convention in
 *      `transcribe-voice.ts:52`).
 *   2. Fallback: user GEMINI_API_KEY direct to Google's generativelanguage
 *      API.
 *   3. Otherwise → throw FeatureNotConfiguredError.
 *
 * Usage:
 *   pnpm action cleanup-transcript --transcript="..." --task=summary
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { readAppSecret } from "@agent-native/core/secrets";
import {
  resolveBuilderCredential,
  resolveBuilderAuthHeader,
  FeatureNotConfiguredError,
} from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

// Builder public LLM gateway base URL. Override via BUILDER_GATEWAY_BASE_URL.
// Mirrors `getBuilderGatewayBaseUrl()` in @agent-native/core/server/credential-provider
// (which isn't re-exported from the package's public surface yet).
const BUILDER_GATEWAY_BASE_URL =
  process.env.BUILDER_GATEWAY_BASE_URL ||
  "https://api.builder.io/codegen/gateway/v1";

// Builder gateway maps this to Gemini 3.1 Flash-Lite (see transcribe-voice.ts:52).
const BUILDER_MODEL = "gemini-3-1-flash-lite";

// BYOK direct-Google fallback — keep on a stable public model id; Builder's
// managed provider handles the 3.1 preview.
const GEMINI_BYOK_MODEL = "gemini-2.0-flash-lite";
const GEMINI_BYOK_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_BYOK_MODEL}:generateContent`;

const MAX_INPUT_CHARS = 200_000;

export interface CleanupResult {
  task: "cleanup" | "title" | "summary";
  // For task='cleanup' — the cleaned transcript text.
  cleanedText?: string;
  // For task='title' — a short title (≤80 chars).
  title?: string;
  // For task='summary' — markdown summary plus structured fields.
  summaryMd?: string;
  bullets?: Array<{ text: string }>;
  actionItems?: Array<{
    assigneeEmail?: string;
    text: string;
    dueDate?: string;
  }>;
  // Provider that fulfilled the call — for observability.
  provider: "builder" | "gemini-byok";
}

export default defineAction({
  description:
    "Run a Gemini 3.1 Flash-Lite cleanup pass on a raw transcript. task='cleanup' returns a cleaned transcript; task='title' returns a short title; task='summary' returns a markdown summary plus structured bullets and action items. This is a server-side media-pipeline path — it does NOT delegate to the agent chat.",
  schema: z.object({
    transcript: z.string().min(1).describe("Raw transcript text to process"),
    task: z
      .enum(["cleanup", "title", "summary"])
      .default("cleanup")
      .describe("Which cleanup pass to run"),
    context: z
      .string()
      .optional()
      .describe(
        "Optional surrounding context (e.g. meeting title, attendees, previous notes) to ground the cleanup pass.",
      ),
    language: z
      .string()
      .optional()
      .describe("Optional ISO language code (e.g. 'en', 'fr')."),
  }),
  run: async (args): Promise<CleanupResult> => {
    const transcript = args.transcript.slice(0, MAX_INPUT_CHARS);
    const prompt = buildPrompt({
      task: args.task,
      transcript,
      context: args.context,
      language: args.language,
    });
    const wantJson = args.task === "summary";

    // 1) Builder gateway (preferred — uses Builder.io Connect credentials).
    const builderAuth = await resolveBuilderAuthHeader();
    if (builderAuth) {
      try {
        const text = await callBuilderGateway({
          authHeader: builderAuth,
          prompt,
          wantJson,
        });
        return shapeResult(args.task, text, "builder");
      } catch (err) {
        // Fall through to BYOK only when Builder is misconfigured / unavailable.
        // Hard errors (e.g. credits exhausted) still surface to the caller.
        const message = (err as Error)?.message ?? String(err);
        if (message.includes("credits exhausted")) throw err;
        console.warn("[cleanup-transcript] Builder path failed:", message);
      }
    }

    // 2) User-scoped BYOK Gemini key.
    const geminiKey = await resolveUserGeminiKey();
    if (geminiKey) {
      const text = await callGeminiByok({
        apiKey: geminiKey,
        prompt,
        wantJson,
      });
      return shapeResult(args.task, text, "gemini-byok");
    }

    throw new FeatureNotConfiguredError({
      requiredCredential: "BUILDER_PRIVATE_KEY or GEMINI_API_KEY",
      message:
        "Transcript cleanup requires either Builder.io Connect or a user-supplied GEMINI_API_KEY. Connect Builder.io in Settings or paste a Gemini key.",
    });
  },
});

async function resolveUserGeminiKey(): Promise<string | null> {
  // Prefer the Builder credential helper for symmetry; falls back to per-user
  // app_secrets for users who pasted their own Gemini key.
  const fromBuilder = await resolveBuilderCredential("GEMINI_API_KEY");
  if (fromBuilder) return fromBuilder;
  const email = getRequestUserEmail();
  if (!email) return null;
  try {
    const secret = await readAppSecret({
      key: "GEMINI_API_KEY",
      scope: "user",
      scopeId: email,
    });
    return secret?.value ?? null;
  } catch {
    return null;
  }
}

async function callBuilderGateway({
  authHeader,
  prompt,
  wantJson,
}: {
  authHeader: string;
  prompt: { system: string; user: string };
  wantJson: boolean;
}): Promise<string> {
  const base = BUILDER_GATEWAY_BASE_URL.replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        model: BUILDER_MODEL,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: 0,
        ...(wantJson ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 402) {
        throw new Error(`Builder credits exhausted: ${body.slice(0, 200)}`);
      }
      throw new Error(`Builder gateway ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

async function callGeminiByok({
  apiKey,
  prompt,
  wantJson,
}: {
  apiKey: string;
  prompt: { system: string; user: string };
  wantJson: boolean;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(GEMINI_BYOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt.system }, { text: prompt.user }],
          },
        ],
        generationConfig: {
          temperature: 0,
          ...(wantJson ? { responseMimeType: "application/json" } : {}),
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    return (
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() ?? ""
    );
  } finally {
    clearTimeout(timeout);
  }
}

function shapeResult(
  task: "cleanup" | "title" | "summary",
  raw: string,
  provider: "builder" | "gemini-byok",
): CleanupResult {
  const stripped = stripEnvelope(raw);
  if (task === "title") {
    return { task, title: stripped.slice(0, 120), provider };
  }
  if (task === "cleanup") {
    return { task, cleanedText: stripped, provider };
  }
  // task === 'summary' — expect JSON.
  try {
    const parsed = JSON.parse(stripped) as {
      summaryMd?: string;
      bullets?: Array<{ text?: string } | string>;
      actionItems?: Array<{
        assigneeEmail?: string;
        text?: string;
        dueDate?: string;
      }>;
    };
    return {
      task,
      summaryMd: typeof parsed.summaryMd === "string" ? parsed.summaryMd : "",
      bullets: Array.isArray(parsed.bullets)
        ? parsed.bullets
            .map((b) =>
              typeof b === "string" ? { text: b } : { text: b.text ?? "" },
            )
            .filter((b) => b.text)
        : [],
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems
            .filter((a) => a && typeof a.text === "string" && a.text.trim())
            .map((a) => ({
              text: (a.text ?? "").trim(),
              ...(a.assigneeEmail ? { assigneeEmail: a.assigneeEmail } : {}),
              ...(a.dueDate ? { dueDate: a.dueDate } : {}),
            }))
        : [],
      provider,
    };
  } catch {
    // Provider didn't return JSON — fall back to raw markdown summary.
    return {
      task,
      summaryMd: stripped,
      bullets: [],
      actionItems: [],
      provider,
    };
  }
}

function stripEnvelope(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json|text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function buildPrompt({
  task,
  transcript,
  context,
  language,
}: {
  task: "cleanup" | "title" | "summary";
  transcript: string;
  context?: string;
  language?: string;
}): { system: string; user: string } {
  const langHint = language ? ` The transcript language is ${language}.` : "";
  const ctxBlock = context ? `\n\n<context>\n${context}\n</context>` : "";

  if (task === "title") {
    return {
      system: `You produce one short, descriptive title for a recorded session. Output the title only — no quotes, no preamble, no markdown. Keep it under 80 characters.${langHint}`,
      user: `Pick a concise, specific title for this transcript:${ctxBlock}\n\n<transcript>\n${transcript}\n</transcript>`,
    };
  }

  if (task === "cleanup") {
    return {
      system: `You clean up live speech-recognition transcripts. Preserve the speaker's meaning and voice. Fix obvious recognition errors, punctuation, capitalization, and spacing. Remove false starts and filler when clearly unintentional. Do not add facts. Output only the cleaned transcript text — no preamble, no markdown.${langHint}`,
      user: `Clean up this transcript and return only the final text:${ctxBlock}\n\n<transcript>\n${transcript}\n</transcript>`,
    };
  }

  // task === 'summary'
  return {
    system: `You summarize meeting recordings. Output a single JSON object matching this TypeScript type and nothing else:
{
  "summaryMd": string,            // 2–4 sentence overview in markdown
  "bullets": Array<{ "text": string }>,   // 3–8 key points, one fact per bullet
  "actionItems": Array<{
    "assigneeEmail"?: string,     // omit if unknown
    "text": string,               // the action, written as an imperative
    "dueDate"?: string            // ISO date if mentioned
  }>
}
Do not invent attendees or commitments that aren't in the transcript.${langHint}`,
    user: `Summarize this meeting and extract action items as JSON:${ctxBlock}\n\n<transcript>\n${transcript}\n</transcript>`,
  };
}
