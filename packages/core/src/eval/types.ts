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
  readonly productionAgentLoopInvoked: boolean;
  readonly requestPreparationInvoked: boolean;
  readonly systemPromptBuilt: boolean;
  readonly finalResponseGuardInstalled: boolean;
  readonly finalResponseGuardApplied: boolean;
  readonly usageCaptured: boolean;
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

/** Adapter contract for a request prepared by the app and run by the shared agent loop. */
export interface EvalProductionChatPath {
  run(args: {
    input: EvalInput;
    identity: EvalProductionIdentity;
    /** Exact action surface permitted for this eval case. */
    actionAllowlist: readonly string[];
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

export interface AgentRunOptions {
  /** Restrict actions before the model receives tools or can search the registry. */
  readonly actionAllowlist?: readonly string[];
}

export interface Eval {
  name: string;
  input: EvalInput;
  /** Restrict this case to named actions before model or tool-search access. */
  actionAllowlist?: readonly string[];
  skipReason?: string;
  run?(ctx: EvalRunContext): AgentRunOutput | Promise<AgentRunOutput>;
  scorers: Scorer<any, any>[];
  threshold?: number;
  /**
   * Provenance for a case promoted from a production run. `runId` is a stable,
   * non-reversible reference, not the production run identifier. Ignored by
   * threshold math and surfaced in `--json` reports.
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
