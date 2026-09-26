
import type { AgentRunOutput, Scorer, ScorerDefinition } from "./types.js";

export function createScorer<Pre = AgentRunOutput, Ana = Pre>(
  def: ScorerDefinition<Pre, Ana>,
): Scorer<Pre, Ana> {
  if (!def.name || typeof def.name !== "string") {
    throw new Error("createScorer: `name` is required");
  }
  if (typeof def.generateScore !== "function") {
    throw new Error(
      `createScorer("${def.name}"): \`generateScore\` is required`,
    );
  }
  return {
    name: def.name,
    preprocess: def.preprocess,
    analyze: def.analyze,
    generateScore: def.generateScore,
    generateReason: def.generateReason,
  };
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}


function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function exactMatch(
  expected: string,
  opts: { caseSensitive?: boolean } = {},
): Scorer<AgentRunOutput, { match: boolean }> {
  return createScorer<AgentRunOutput, { match: boolean }>({
    name: "exact_match",
    analyze(run) {
      const actual = opts.caseSensitive ? run.text.trim() : normalize(run.text);
      const want = opts.caseSensitive ? expected.trim() : normalize(expected);
      return { match: actual === want };
    },
    generateScore({ match }) {
      return match ? 1 : 0;
    },
    generateReason({ analysis }) {
      return analysis.match
        ? `Output exactly matched expected text`
        : `Output did not exactly match expected text`;
    },
  });
}

export function contains(
  needles: string | string[],
  opts: { caseSensitive?: boolean } = {},
): Scorer<AgentRunOutput, { found: string[]; missing: string[] }> {
  const list = (Array.isArray(needles) ? needles : [needles]).filter(Boolean);
  return createScorer<AgentRunOutput, { found: string[]; missing: string[] }>({
    name: "contains",
    analyze(run) {
      const hay = opts.caseSensitive ? run.text : run.text.toLowerCase();
      const found: string[] = [];
      const missing: string[] = [];
      for (const n of list) {
        const needle = opts.caseSensitive ? n : n.toLowerCase();
        if (hay.includes(needle)) found.push(n);
        else missing.push(n);
      }
      return { found, missing };
    },
    generateScore({ found }) {
      return list.length === 0 ? 1 : found.length / list.length;
    },
    generateReason({ analysis }) {
      if (analysis.missing.length === 0) {
        return `All ${list.length} required phrase(s) present`;
      }
      return `Missing: ${analysis.missing.join(", ")}`;
    },
  });
}

export function usesTool(
  toolName: string,
): Scorer<AgentRunOutput, { used: boolean }> {
  return createScorer<AgentRunOutput, { used: boolean }>({
    name: `uses_tool:${toolName}`,
    analyze(run) {
      return { used: run.toolCalls.includes(toolName) };
    },
    generateScore({ used }) {
      return used ? 1 : 0;
    },
    generateReason({ analysis }) {
      return analysis.used
        ? `Agent called \`${toolName}\``
        : `Agent never called \`${toolName}\``;
    },
  });
}


interface JudgeVerdict {
  score: number;
  reasoning: string;
}

function parseJudgeVerdict(text: string): JudgeVerdict | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<JudgeVerdict>;
    if (typeof parsed.score !== "number") return null;
    return {
      score: parsed.score,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    return null;
  }
}

export interface LlmJudgeOptions {
  name?: string;
  criteria: string;
  rubric?: string;
  scoreRange?: { min: number; max: number };
}

export function llmJudge(
  opts: LlmJudgeOptions,
): Scorer<
  AgentRunOutput,
  { verdict: JudgeVerdict | null; normalized: number }
> {
  const min = opts.scoreRange?.min ?? 0;
  const max = opts.scoreRange?.max ?? 1;
  const name = opts.name ?? "llm_judge";

  return createScorer<
    AgentRunOutput,
    { verdict: JudgeVerdict | null; normalized: number }
  >({
    name,
    async analyze(run, ctx) {
      const prompt = `You are an expert evaluator. Score the agent output below against the criteria.

## Criteria
${opts.criteria}${opts.rubric ? `\n\n## Rubric\n${opts.rubric}` : ""}

## Agent Output
${run.text || "(no text output)"}

## Tools the agent used
${run.toolCalls.length ? run.toolCalls.join(", ") : "(none)"}

## Instructions
Respond with ONLY a JSON object (no markdown, no prose outside the JSON):
{"score": <number between ${min} and ${max}>, "reasoning": "<brief explanation>"}`;

      const text = await ctx.judge({
        systemPrompt:
          "You are an evaluation judge. Respond only with valid JSON.",
        prompt,
        maxOutputTokens: 512,
      });
      const verdict = parseJudgeVerdict(text);
      const normalized =
        verdict === null
          ? 0
          : max > min
            ? (verdict.score - min) / (max - min)
            : verdict.score;
      return { verdict, normalized };
    },
    generateScore({ normalized }) {
      return clamp01(normalized);
    },
    generateReason({ analysis }) {
      if (analysis.verdict === null) {
        return "Judge did not return a parseable verdict";
      }
      return analysis.verdict.reasoning || "(no reasoning provided)";
    },
  });
}
