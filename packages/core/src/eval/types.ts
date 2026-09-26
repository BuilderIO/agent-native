
import type { AgentEngine } from "../agent/engine/types.js";


export interface AgentRunOutput {
  readonly text: string;
  readonly toolCalls: readonly string[];
  readonly toolCallDetails?: readonly {
    readonly name: string;
    readonly input: unknown;
    readonly startedAtEventIndex?: number;
    readonly completedAtEventIndex?: number;
    readonly completed?: boolean;
    readonly completedSideEffect?: boolean;
    readonly isError?: boolean;
    readonly result?: string;
  }[];
  readonly ok: boolean;
  readonly error?: string;
  readonly runId: string;
  readonly durationMs: number;
}


export interface ScorerAnalyzeContext {
  readonly engine: AgentEngine;
  readonly model: string;
  judge(opts: {
    systemPrompt?: string;
    prompt: string;
    maxOutputTokens?: number;
    signal?: AbortSignal;
  }): Promise<string>;
}

export interface Scorer<Pre = AgentRunOutput, Ana = Pre> {
  readonly name: string;
  preprocess?(run: AgentRunOutput): Pre | Promise<Pre>;
  analyze?(input: Pre, ctx: ScorerAnalyzeContext): Ana | Promise<Ana>;
  generateScore(analysis: Ana): number | Promise<number>;
  generateReason?(args: {
    run: AgentRunOutput;
    analysis: Ana;
    score: number;
  }): string | Promise<string>;
}

export interface ScorerDefinition<Pre = AgentRunOutput, Ana = Pre> {
  name: string;
  preprocess?(run: AgentRunOutput): Pre | Promise<Pre>;
  analyze?(input: Pre, ctx: ScorerAnalyzeContext): Ana | Promise<Ana>;
  generateScore(analysis: Ana): number | Promise<number>;
  generateReason?(args: {
    run: AgentRunOutput;
    analysis: Ana;
    score: number;
  }): string | Promise<string>;
}


export interface EvalInput {
  prompt: string;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
}

export interface EvalRunContext {
  readonly input: EvalInput;
  runAgent(input: EvalInput): Promise<AgentRunOutput>;
}

export interface Eval {
  name: string;
  input: EvalInput;
  skipReason?: string;
  run?(ctx: EvalRunContext): AgentRunOutput | Promise<AgentRunOutput>;
  scorers: Scorer<any, any>[];
  threshold?: number;
}


export interface ScorerResult {
  scorer: string;
  score: number;
  reason?: string;
  passed: boolean;
}

export interface EvalResultRow {
  eval: string;
  threshold: number;
  scores: ScorerResult[];
  status?: "passed" | "failed" | "skipped";
  skipReason?: string;
  passed: boolean;
  avgScore: number;
  durationMs: number;
  error?: string;
}

export interface EvalRunReport {
  total: number;
  passed: number;
  failed: number;
  skipped?: number;
  results: EvalResultRow[];
}
