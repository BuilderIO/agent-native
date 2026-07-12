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
 *   1. Builder.io Connect credentials → Builder engine with model
 *      `gemini-3-1-flash-lite` (matches existing convention in
 *      `transcribe-voice.ts`).
 *   2. Fallback: user GEMINI_API_KEY direct to Google's generativelanguage
 *      API.
 *   3. Otherwise → throw FeatureNotConfiguredError.
 *
 * Usage:
 *   pnpm action cleanup-transcript --transcript="..." --task=summary
 */

import { defineAction } from "@agent-native/core";
import { createBuilderEngine } from "@agent-native/core/agent/engine";
import {
  resolveBuilderCredentials,
  resolveSecret,
  FeatureNotConfiguredError,
} from "@agent-native/core/server";
import {
  applyVoiceContextReplacements,
  formatVoiceContextPackForPrompt,
  type VoiceContextPack,
} from "@agent-native/core/voice";
import { z } from "zod";

import { isBuilderCreditsExhaustedMessage } from "../shared/builder-credits.js";
import {
  clearBuilderCreditsExhausted,
  noteBuilderCreditsExhausted,
} from "./lib/builder-credits-state.js";

// Builder gateway maps this to Gemini 3.1 Flash-Lite (see transcribe-voice.ts:52).
const BUILDER_MODEL = "gemini-3-1-flash-lite";

// BYOK direct-Google fallback — keep on a stable public model id; Builder's
// managed provider handles the 3.1 preview.
const GEMINI_BYOK_MODEL = "gemini-2.0-flash-lite";
const GEMINI_BYOK_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_BYOK_MODEL}:generateContent`;

const MAX_INPUT_CHARS = 200_000;

const CLIPS_TRANSCRIPT_AGENT_INSTRUCTIONS = [
  "Relevant Clips AGENTS.md rules:",
  "- User-facing language calls a recording a Clip.",
  "- Generated titles should be concise, specific, and human-editable.",
  "- Native Web Speech/macOS Speech text is the source transcript; Gemini only cleans or titles it.",
  "- Cleanup preserves the speaker's meaning and voice, fixes recognition errors, and must not invent facts.",
].join("\n");

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
    contextPack: z
      .unknown()
      .optional()
      .describe(
        "Optional structured voice context: snippets, vocabulary replacements, and metadata.",
      ),
    language: z
      .string()
      .optional()
      .describe("Optional ISO language code (e.g. 'en', 'fr')."),
  }),
  run: async (args): Promise<CleanupResult> => {
    const transcript = args.transcript.slice(0, MAX_INPUT_CHARS);
    const contextPack = args.contextPack as VoiceContextPack | undefined;
    const prompt = buildPrompt({
      task: args.task,
      transcript,
      context: args.context,
      contextPack,
      language: args.language,
    });
    const wantJson = args.task === "summary";

    // 1) Builder gateway (preferred — uses Builder.io Connect credentials).
    const builderCreds = await resolveBuilderCredentials();
    const builderConfigured = Boolean(
      builderCreds.privateKey && builderCreds.publicKey,
    );
    const builderPartiallyConfigured = Boolean(
      builderCreds.privateKey || builderCreds.publicKey,
    );
    let builderReturnedEmpty = false;
    let builderFailureMessage: string | null = null;

    if (builderConfigured) {
      try {
        const text = await callBuilderGateway({
          prompt,
          wantJson,
        });
        if (text.trim()) {
          await clearBuilderCreditsExhausted();
          return shapeResult(args.task, text, "builder", contextPack);
        }
        builderReturnedEmpty = true;
        console.warn("[cleanup-transcript] Builder path returned empty text");
      } catch (err) {
        const message = (err as Error)?.message ?? String(err);
        builderFailureMessage = message;
        if (isBuilderCreditsExhaustedMessage(message)) {
          await noteBuilderCreditsExhausted({
            source:
              args.task === "title"
                ? "title"
                : args.task === "summary"
                  ? "summary"
                  : "cleanup",
            message,
          });
          console.warn(
            "[cleanup-transcript] Builder credits exhausted; trying BYOK fallback",
          );
        } else {
          console.warn("[cleanup-transcript] Builder path failed:", message);
        }
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
      return shapeResult(args.task, text, "gemini-byok", contextPack);
    }

    throw buildCleanupConfigurationError({
      builderConfigured,
      builderPartiallyConfigured,
      builderReturnedEmpty,
      builderFailureMessage,
    });
  },
});

async function resolveUserGeminiKey(): Promise<string | null> {
  return await resolveSecret("GEMINI_API_KEY");
}

async function callBuilderGateway({
  prompt,
  wantJson,
}: {
  prompt: { system: string; user: string };
  wantJson: boolean;
}): Promise<string> {
  const engine = createBuilderEngine();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let streamedText = "";
  let finalText = "";
  let terminalError: string | undefined;

  try {
    const events = engine.stream({
      model: BUILDER_MODEL,
      systemPrompt: prompt.system,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt.user }],
        },
      ],
      tools: [],
      abortSignal: controller.signal,
      maxOutputTokens: wantJson ? 4096 : 1024,
      temperature: 0,
    });
    for await (const event of events) {
      if (event.type === "text-delta") streamedText += event.text;
      if (event.type === "assistant-content") {
        finalText = event.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
          .trim();
      }
      if (event.type === "stop" && event.reason === "error") {
        terminalError =
          event.error ??
          (event.errorCode
            ? `Builder gateway returned ${event.errorCode}`
            : "Builder gateway returned an error");
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  if (terminalError) throw new Error(terminalError);
  return (finalText || streamedText).trim();
}

function buildCleanupConfigurationError({
  builderConfigured,
  builderPartiallyConfigured,
  builderReturnedEmpty,
  builderFailureMessage,
}: {
  builderConfigured: boolean;
  builderPartiallyConfigured: boolean;
  builderReturnedEmpty: boolean;
  builderFailureMessage: string | null;
}): FeatureNotConfiguredError {
  let message =
    "Transcript cleanup needs Builder.io Connect or a fallback AI key.";

  if (builderConfigured && builderReturnedEmpty) {
    message =
      "Builder.io is connected, but the cleanup/title service returned no text. Native transcript was kept; retry or add a fallback AI key.";
  } else if (builderConfigured && builderFailureMessage) {
    const detail =
      builderFailureMessage.length > 240
        ? `${builderFailureMessage.slice(0, 240)}...`
        : builderFailureMessage;
    message = `Builder.io is connected, but the cleanup/title service failed: ${detail}`;
  } else if (builderPartiallyConfigured) {
    message =
      "Builder.io Connect is incomplete. Reconnect Builder.io in Settings or add a fallback AI key.";
  }

  return new FeatureNotConfiguredError({
    requiredCredential:
      "BUILDER_PRIVATE_KEY and BUILDER_PUBLIC_KEY, or GEMINI_API_KEY",
    message,
  });
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
  contextPack?: VoiceContextPack,
): CleanupResult {
  const stripped = stripEnvelope(raw);
  const applyContext = (value: string) =>
    applyVoiceContextReplacements(value, contextPack).trim();
  if (task === "title") {
    return { task, title: applyContext(stripped).slice(0, 120), provider };
  }
  if (task === "cleanup") {
    return { task, cleanedText: applyContext(stripped), provider };
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
      summaryMd:
        typeof parsed.summaryMd === "string"
          ? applyContext(parsed.summaryMd)
          : "",
      bullets: Array.isArray(parsed.bullets)
        ? parsed.bullets
            .map((b) =>
              typeof b === "string"
                ? { text: applyContext(b) }
                : { text: applyContext(b.text ?? "") },
            )
            .filter((b) => b.text)
        : [],
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems
            .filter((a) => a && typeof a.text === "string" && a.text.trim())
            .map((a) => {
              // assigneeEmail must be a non-empty string that looks like an
              // email; everything else (null, "", "unknown", display name)
              // collapses to undefined so the downstream UI shows "unassigned".
              const rawEmail =
                typeof a.assigneeEmail === "string"
                  ? a.assigneeEmail.trim()
                  : "";
              const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
              return {
                text: applyContext(a.text ?? ""),
                ...(isEmail ? { assigneeEmail: rawEmail } : {}),
                ...(a.dueDate ? { dueDate: a.dueDate } : {}),
              };
            })
        : [],
      provider,
    };
  } catch {
    // Provider didn't return JSON — fall back to raw markdown summary.
    return {
      task,
      summaryMd: applyContext(stripped),
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
  contextPack,
  language,
}: {
  task: "cleanup" | "title" | "summary";
  transcript: string;
  context?: string;
  contextPack?: VoiceContextPack;
  language?: string;
}): { system: string; user: string } {
  const langHint = language ? ` The transcript language is ${language}.` : "";
  const voiceContext = formatVoiceContextPackForPrompt(contextPack);
  const contextParts = [
    context?.trim(),
    voiceContext ? `Voice context:\n${voiceContext}` : "",
  ].filter(Boolean);
  const ctxBlock = contextParts.length
    ? `\n\n<context>\n${contextParts.join("\n\n")}\n</context>`
    : "";

  if (task === "title") {
    return {
      system: `${CLIPS_TRANSCRIPT_AGENT_INSTRUCTIONS}\n\nYou produce one short, descriptive title for a Clip. The title must summarize the main subject covered in the transcript, not quote an opening aside. Ignore conversational setup and filler such as "let me walk through this", "real quick", "regarding your question", "there are two things", greetings, hesitation, and other meta commentary. Prefer the concrete topic, named entities, numbers, product names, and business terms that explain what the Clip is actually about. Do not use vague titles built from words like "quick", "thing", "question", "walkthrough", "scenario", or "discussion" unless they are the real topic. If AGENTS.md resources are included in <context>, use them only for relevant naming, terminology, style, and personal/team preferences; personal instructions win over organization instructions. Output the title only — no quotes, no preamble, no markdown. Keep it 4-9 words and under 80 characters.${langHint}`,
      user: `Pick a concise, specific title that summarizes the main subject of this transcript:${ctxBlock}\n\n<transcript>\n${transcript}\n</transcript>`,
    };
  }

  if (task === "cleanup") {
    return {
      system: `${CLIPS_TRANSCRIPT_AGENT_INSTRUCTIONS}\n\nYou clean up live speech-recognition transcripts. If AGENTS.md resources are included in <context>, use them only for relevant cleanup preferences: vocabulary, casing, punctuation style, formatting style, terminology, speaker voice, and team/personal conventions; personal instructions win over organization instructions. Preserve the speaker's meaning and voice. Fix obvious recognition errors, punctuation, capitalization, and spacing. Remove false starts and filler when clearly unintentional. Do not add facts. Output only the cleaned transcript text — no preamble, no markdown.${langHint}`,
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
    "assigneeEmail": string | null, // attendee email (must match one of the attendees provided in <context>) — set to null when the owner is unclear
    "text": string,                 // the action, written as an imperative
    "dueDate"?: string              // ISO date if explicitly mentioned
  }>
}
Rules for action items:
- Attribute each action item to a specific attendee whenever the transcript makes the owner clear (e.g. "I'll send the deck", "Alice will follow up").
- The "assigneeEmail" MUST be one of the attendee emails listed in the <context> block above — do not invent emails or use display names.
- If an action item's owner is unclear, set "assigneeEmail" to null rather than guessing.
- Do not invent attendees, commitments, or due dates that aren't in the transcript.${langHint}`,
    user: `Summarize this meeting and extract action items as JSON. Use the attendee list in <context> to attribute owners:${ctxBlock}\n\n<transcript>\n${transcript}\n</transcript>`,
  };
}
