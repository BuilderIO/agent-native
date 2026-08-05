import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import type {
  AnalyzeTranscriptInput,
  RedactionSuggestion,
  TranscriptAnalysis,
} from "../app/lib/transcript-types.js";

const audienceSchema = z.enum(["public", "external", "internal"]);

type Detector = {
  category: string;
  pattern: RegExp;
  rationale: string;
  replacement: string;
  severity: "high" | "medium";
};

type LineMatch = Omit<RedactionSuggestion, "id" | "line"> & {
  end: number;
  start: number;
};

const detectors: Detector[] = [
  {
    category: "Email address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    rationale: "Contact details can identify a person or workspace.",
    replacement: "[EMAIL]",
    severity: "medium",
  },
  {
    category: "Phone number",
    pattern: /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}/g,
    rationale: "Phone numbers are personal contact information.",
    replacement: "[PHONE]",
    severity: "medium",
  },
  {
    category: "Access token",
    pattern: /\b(?:sk|pk|api|token|secret)[-_][a-z0-9_-]{8,}\b/gi,
    rationale: "Credentials should never travel in a shared transcript.",
    replacement: "[SECRET]",
    severity: "high",
  },
  {
    category: "IP address",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    rationale: "Infrastructure addresses can reveal private systems.",
    replacement: "[IP ADDRESS]",
    severity: "medium",
  },
  {
    category: "Link",
    pattern: /https?:\/\/[^\s)]+/gi,
    rationale: "Links may expose private documents or internal systems.",
    replacement: "[LINK]",
    severity: "medium",
  },
  {
    category: "Labeled person name",
    pattern:
      /\b(?:[Nn]ame|[Ss]peaker|[Aa]ttendee|[Cc]ontact)\s*:\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}/g,
    rationale:
      "A named person can be identifying context in a shared transcript.",
    replacement: "[PERSON]",
    severity: "medium",
  },
];

const sensitiveLinePattern =
  /\b(confidential|private|internal only|do not share|customer data|personal data|salary|medical|security incident)\b/i;

function maskPreview(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 4) return "••••";
  const maskLength = Math.min(8, Math.max(3, compact.length - 4));
  return `${compact.slice(0, 2)}${"•".repeat(maskLength)}${compact.slice(-2)}`;
}

function lineMatches(line: string): LineMatch[] {
  const matches: LineMatch[] = [];

  for (const detector of detectors) {
    detector.pattern.lastIndex = 0;
    for (const match of line.matchAll(detector.pattern)) {
      const value = match[0];
      const start = match.index ?? 0;
      matches.push({
        category: detector.category,
        end: start + value.length,
        matchPreview: maskPreview(value),
        rationale: detector.rationale,
        replacement: detector.replacement,
        severity: detector.severity,
        start,
      });
    }
  }

  return matches
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((match, index, all) => {
      const previous = all
        .slice(0, index)
        .find(
          (candidate) =>
            candidate.start < match.end && candidate.end > match.start,
        );
      return !previous;
    });
}

function redactLine(line: string, matches: LineMatch[]) {
  let cursor = 0;
  let result = "";

  for (const match of matches) {
    result += line.slice(cursor, match.start);
    result += match.replacement;
    cursor = match.end;
  }

  return result + line.slice(cursor);
}

function audienceLead(audience: AnalyzeTranscriptInput["audience"]) {
  switch (audience) {
    case "public":
      return "A high-level version for public sharing:";
    case "external":
      return "A concise version for an external audience:";
    case "internal":
      return "A cleaned-up version for your internal team:";
  }
}

function makeSafeSummary(
  transcript: string,
  audience: AnalyzeTranscriptInput["audience"],
) {
  const lines = transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const safeLines = lines
    .filter((line) => !sensitiveLinePattern.test(line))
    .map((line) => redactLine(line, lineMatches(line)))
    .map((line) => (line.length > 180 ? `${line.slice(0, 177)}…` : line))
    .slice(0, 4);

  if (safeLines.length === 0) {
    return `${audienceLead(audience)}\n- The transcript needs a manual review before a safe summary can be drafted.`;
  }

  return [audienceLead(audience), ...safeLines.map((line) => `- ${line}`)].join(
    "\n",
  );
}

function analyzeTranscript({
  audience,
  transcript,
}: AnalyzeTranscriptInput): TranscriptAnalysis {
  const redactions: RedactionSuggestion[] = [];
  const lines = transcript.split(/\r?\n/);

  lines.forEach((line, index) => {
    const matches = lineMatches(line);
    matches.forEach((match, matchIndex) => {
      redactions.push({
        id: `match-${index + 1}-${matchIndex + 1}`,
        category: match.category,
        line: index + 1,
        matchPreview: match.matchPreview,
        rationale: match.rationale,
        replacement: match.replacement,
        severity: match.severity,
      });
    });

    if (sensitiveLinePattern.test(line)) {
      redactions.push({
        id: `line-${index + 1}`,
        category: "Sensitive line",
        line: index + 1,
        matchPreview: maskPreview(line),
        rationale:
          "The line signals content that needs a human sharing decision.",
        replacement: "[REVIEW LINE]",
        severity: "high",
      });
    }
  });

  const hasHighRisk = redactions.some((item) => item.severity === "high");
  return {
    audience,
    characterCount: transcript.length,
    redactionCount: redactions.length,
    risk: hasHighRisk ? "high" : redactions.length > 0 ? "medium" : "low",
    safeSummary: makeSafeSummary(transcript, audience),
    redactions,
  };
}

export default defineAction({
  description:
    "Analyze a pasted transcript for share-sensitive patterns and draft a bounded safe summary. Treat the result as a review aid, not a guarantee that every sensitive detail was found.",
  schema: z.object({
    audience: audienceSchema.describe("Who will receive the exported summary"),
    transcript: z
      .string()
      .trim()
      .min(1)
      .max(100_000)
      .describe("Transcript text to review"),
  }),
  readOnly: true,
  run: async (args) => analyzeTranscript(args),
});
