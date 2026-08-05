export type Audience = "public" | "external" | "internal";

export type RedactionSeverity = "high" | "medium";

export interface RedactionSuggestion {
  id: string;
  category: string;
  line: number;
  replacement: string;
  matchPreview: string;
  rationale: string;
  severity: RedactionSeverity;
}

export interface TranscriptAnalysis {
  audience: Audience;
  characterCount: number;
  redactionCount: number;
  risk: "low" | "medium" | "high";
  safeSummary: string;
  redactions: RedactionSuggestion[];
}

export interface AnalyzeTranscriptInput {
  audience: Audience;
  transcript: string;
}
