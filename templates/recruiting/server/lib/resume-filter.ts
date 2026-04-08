import Anthropic from "@anthropic-ai/sdk";
import { PDFParse } from "pdf-parse";
import type { GreenhouseCandidate } from "@shared/types";
import { getApiKey } from "./greenhouse-api.js";

export type FilterResult = {
  candidateId: number;
  name: string;
  match: boolean;
  reasoning: string;
  confidence: "high" | "medium" | "low";
};

export type FilterResponse = {
  prompt: string;
  results: FilterResult[];
  totalEvaluated: number;
};

/**
 * Build a text profile for a candidate from their structured data + resume attachment.
 */
async function buildCandidateProfile(
  candidate: GreenhouseCandidate,
): Promise<string> {
  const parts: string[] = [];

  const name = [candidate.first_name, candidate.last_name]
    .filter(Boolean)
    .join(" ");
  parts.push(`Name: ${name}`);
  if (candidate.title) parts.push(`Title: ${candidate.title}`);
  if (candidate.company) parts.push(`Company: ${candidate.company}`);
  if (candidate.tags.length > 0)
    parts.push(`Tags: ${candidate.tags.join(", ")}`);

  // Application info
  for (const app of candidate.applications) {
    const jobNames = app.jobs.map((j) => j.name).join(", ");
    if (jobNames) parts.push(`Applied to: ${jobNames}`);
    if (app.current_stage) parts.push(`Stage: ${app.current_stage.name}`);
    if (app.source) parts.push(`Source: ${app.source.public_name}`);

    // Application answers (custom questions)
    for (const answer of app.answers || []) {
      if (answer.answer) {
        parts.push(`Q: ${answer.question}\nA: ${answer.answer}`);
      }
    }

    // Try to extract resume text from attachments
    for (const attachment of app.attachments || []) {
      if (!attachment.url) continue;
      const resumeText = await extractAttachmentText(attachment);
      if (resumeText) {
        parts.push(`\n--- Resume (${attachment.filename}) ---\n${resumeText}`);
      }
    }
  }

  return parts.join("\n");
}

/**
 * Download and extract text from an attachment (PDF or plain text).
 */
async function extractAttachmentText(attachment: {
  filename: string;
  url: string;
  type: string;
}): Promise<string | null> {
  try {
    // Greenhouse attachment URLs require the same API key auth
    const apiKey = await getApiKey();
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["Authorization"] =
        `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
    }

    const res = await fetch(attachment.url, { headers });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    const filename = attachment.filename.toLowerCase();

    if (filename.endsWith(".pdf") || contentType.includes("pdf")) {
      const arrayBuffer = await res.arrayBuffer();
      const pdf = new PDFParse({ data: new Uint8Array(arrayBuffer) });
      const result = await pdf.getText();
      return result.text?.trim() || null;
    }

    if (
      filename.endsWith(".txt") ||
      filename.endsWith(".md") ||
      contentType.includes("text/")
    ) {
      return await res.text();
    }

    // For DOCX and other formats, skip (we could add mammoth later)
    return null;
  } catch {
    return null;
  }
}

/**
 * Filter candidates against a natural language prompt using Claude.
 * Processes candidates in batches for efficiency.
 */
export async function filterCandidates(
  candidates: GreenhouseCandidate[],
  prompt: string,
): Promise<FilterResponse> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for AI-powered resume filtering",
    );
  }

  const client = new Anthropic({ apiKey: anthropicKey });
  const BATCH_SIZE = 10;
  const results: FilterResult[] = [];

  // Build profiles for all candidates
  const profiles = await Promise.all(
    candidates.map(async (c) => ({
      candidate: c,
      profile: await buildCandidateProfile(c),
    })),
  );

  // Process in batches
  for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
    const batch = profiles.slice(i, i + BATCH_SIZE);
    const batchResults = await evaluateBatch(client, batch, prompt);
    results.push(...batchResults);
  }

  // Sort: matches first, then by confidence
  const confidenceOrder = { high: 0, medium: 1, low: 2 };
  results.sort((a, b) => {
    if (a.match !== b.match) return a.match ? -1 : 1;
    return confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
  });

  return {
    prompt,
    results,
    totalEvaluated: candidates.length,
  };
}

async function evaluateBatch(
  client: Anthropic,
  batch: { candidate: GreenhouseCandidate; profile: string }[],
  prompt: string,
): Promise<FilterResult[]> {
  const candidateBlocks = batch
    .map(
      ({ candidate, profile }, idx) =>
        `<candidate id="${candidate.id}" index="${idx}">\n${profile}\n</candidate>`,
    )
    .join("\n\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: `You are an expert recruiting assistant that evaluates candidate profiles against hiring criteria. You return structured JSON assessments.

Always respond with a valid JSON array. Each element must have:
- "candidateId": number (the candidate's ID from the <candidate> tag)
- "match": boolean (true if the candidate meets the criteria)
- "reasoning": string (1-2 sentence explanation of why they match or don't)
- "confidence": "high" | "medium" | "low" (how confident you are in the assessment)

Base your assessment on all available information: resume content, job titles, companies, tags, application answers, etc. If a candidate has limited information, set confidence to "low".`,
    messages: [
      {
        role: "user",
        content: `Evaluate these candidates against the following criteria:

"${prompt}"

${candidateBlocks}

Return a JSON array with one assessment per candidate.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      candidateId: number;
      match: boolean;
      reasoning: string;
      confidence: "high" | "medium" | "low";
    }>;

    return parsed.map((r) => {
      const candidate = batch.find((b) => b.candidate.id === r.candidateId);
      const name = candidate
        ? [candidate.candidate.first_name, candidate.candidate.last_name]
            .filter(Boolean)
            .join(" ")
        : `Candidate ${r.candidateId}`;

      return {
        candidateId: r.candidateId,
        name,
        match: r.match,
        reasoning: r.reasoning,
        confidence: r.confidence,
      };
    });
  } catch {
    return [];
  }
}
