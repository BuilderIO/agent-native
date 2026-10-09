import type { AgentEngine } from "../agent/engine/types.js";
import type {
  ActionEntry,
  AgentLoopFinalResponseGuard,
  AgentLoopUsage,
} from "../agent/production-agent.js";

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
  readonly usage?: AgentLoopUsage;
}

/**
 * The app-owned inputs used for a production-path eval. The identity fields
 * are explicit because a CLI run has no authenticated HTTP request to borrow
 * them from; `orgId: null` is a deliberate personal-org selection.
 */
export interface EvalProductionContext {
  readonly actions: Record<string, ActionEntry>;
  readonly systemPrompt: string;
  readonly finalResponseGuard: AgentLoopFinalResponseGuard | null;
  readonly ownerEmail: string;
  readonly orgId: string | null;
  readonly appId?: string;
  /** Initial production tool surface; remaining actions stay available for tool-search. */
  readonly initialToolNames?: readonly string[];
  /** Present only when this adapter can invoke and attest the actual chat request path. */
  readonly productionChatPath?: EvalProductionChatPath;
}

export interface EvalProductionIdentity {
  readonly ownerEmail: string;
  readonly orgId: string;
}

export type EvalPrefetchStatus = "ok" | "empty" | "timed_out" | "failed";

/** Runtime evidence returned by an adapter that invokes the production chat path. */
export interface EvalProductionPathReceipt {
  readonly chatHandlerInvoked: true;
  readonly requestPreparationInvoked: true;
  readonly systemPromptBuilt: true;
  readonly finalResponseGuardInstalled: true;
  readonly finalResponseGuardApplied: true;
  readonly usageCaptured: true;
  readonly prefetchStatus: EvalPrefetchStatus;
  readonly ownerEmail: string;
  readonly orgId: string;
  readonly initialToolNames: readonly string[];
  readonly availableActionNames: readonly string[];
  readonly readOnlyActionNames: readonly string[];
}

export interface EvalProductionPathRun {
  readonly output: AgentRunOutput;
  readonly receipt: EvalProductionPathReceipt;
}

/** Adapter contract for a request executed by the mounted production chat handler. */
export interface EvalProductionChatPath {
  run(args: {
    input: EvalInput;
    identity: EvalProductionIdentity;
    engine: AgentEngine;
    model: string;
    signal: AbortSignal;
    onUsage(usage: AgentLoopUsage): void;
  }): Promise<EvalProductionPathRun>;
}

export type EvalProductionContextResolver = (
  identity: EvalProductionIdentity,
) => EvalProductionContext | Promise<EvalProductionContext>;

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
  /**
   * Provenance for a case promoted from a production run. Ignored by
   * threshold math; surfaced in `--json` reports so a CI failure can point
   * back at the trace.
   */
  source?: { kind: "trace"; runId: string };
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
  usage?: AgentLoopUsage;
  /** Copied from the eval case when present; ignored for pass/fail. */
  source?: { kind: "trace"; runId: string };
}

export interface EvalRunReport {
  total: number;
  passed: number;
  failed: number;
  skipped?: number;
  results: EvalResultRow[];
}
