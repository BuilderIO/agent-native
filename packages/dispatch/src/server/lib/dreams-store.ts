import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import {
  resourceGetByPath,
  resourceList,
  resourcePut,
  SHARED_OWNER,
} from "@agent-native/core/resources/store";
import { getDb, schema } from "../../db/index.js";
import {
  currentOrgId,
  currentOwnerEmail,
  recordAudit,
  type DispatchCtx,
} from "./dispatch-store.js";
import {
  getAgentThreadDebug,
  searchAgentThreads,
} from "./thread-debug-store.js";

const DEFAULT_DREAM_LIMIT = 20;
const MAX_DREAM_LIMIT = 50;
const MEMORY_INDEX_PATH = "memory/MEMORY.md";
const DREAM_JOB_PATH = "jobs/dispatch-dream.md";
const DEFAULT_DREAM_CRON = "0 9 * * 1";

type DreamRow = typeof schema.dispatchDreams.$inferSelect;
type DreamProposalRow = typeof schema.dispatchDreamProposals.$inferSelect;

type DreamStatus = "running" | "completed" | "failed";
type ProposalStatus = "pending" | "applied" | "rejected";
type ProposalTargetType = "personal-memory" | "shared-learnings";
type ProposalRisk = "low" | "medium" | "high";

interface DreamCandidateReason {
  code: string;
  label: string;
  score: number;
  evidenceCount: number;
}

export interface DreamEvidence {
  kind: string;
  label: string;
  snippet: string;
  threadId: string;
  threadTitle?: string;
  runId?: string | null;
  messageIndex?: number;
  createdAt?: number | null;
}

export interface DreamCandidate {
  thread: {
    id: string;
    ownerEmail: string;
    title: string;
    preview: string;
    messageCount: number;
    createdAt: number;
    updatedAt: number;
  };
  sourceId: string;
  score: number;
  reasons: DreamCandidateReason[];
  evidenceCounts: Record<string, number>;
  evidence: DreamEvidence[];
  latestRunStatus: string | null;
}

export interface DreamProposalInput {
  targetType: ProposalTargetType;
  targetPath: string;
  title: string;
  summary: string;
  rationale: string;
  content: string;
  evidence: DreamEvidence[];
  confidence: number;
  risk: ProposalRisk;
}

export interface DreamMemoryNote {
  path: string;
  content: string;
}

export interface DreamMemoryContext {
  personalIndex: string;
  personalNotes: DreamMemoryNote[];
  sharedLearnings: string;
}

export interface DreamProposalBuildResult {
  proposals: DreamProposalInput[];
  guardrailNotes: string[];
}

function id() {
  return crypto.randomUUID();
}

function now() {
  return Date.now();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function clampLimit(limit: number | undefined) {
  return Math.max(1, Math.min(MAX_DREAM_LIMIT, limit ?? DEFAULT_DREAM_LIMIT));
}

function scopeFor<T extends { ownerEmail: any; orgId: any }>(
  table: T,
  ctx: DispatchCtx,
) {
  if (!ctx.orgId) {
    return and(eq(table.ownerEmail, ctx.ownerEmail), isNull(table.orgId));
  }
  return or(eq(table.ownerEmail, ctx.ownerEmail), eq(table.orgId, ctx.orgId));
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "null";
  }
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function compactText(value: unknown, max = 260): string {
  const raw =
    typeof value === "string" ? value : value == null ? "" : safeJson(value);
  const redacted = raw
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-REDACTED")
    .replace(/anthropic-[A-Za-z0-9_-]{12,}/gi, "anthropic-REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer REDACTED")
    .replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, "REDACTED_TOKEN")
    .replace(/\s+/g, " ")
    .trim();
  if (redacted.length <= max) return redacted;
  return `${redacted.slice(0, max - 1).trimEnd()}…`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "dispatch-dream";
}

function parseNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function objectText(value: unknown): string {
  return compactText(value, 1_200).toLowerCase();
}

function isFailureStatus(status: unknown): boolean {
  const value = String(status ?? "").toLowerCase();
  return (
    value.includes("fail") ||
    value.includes("error") ||
    value.includes("abort") ||
    value.includes("cancel") ||
    value.includes("timeout")
  );
}

function isSuccessStatus(status: unknown): boolean {
  const value = String(status ?? "").toLowerCase();
  return (
    value === "success" ||
    value === "succeeded" ||
    value === "completed" ||
    value === "complete"
  );
}

function isNegativeFeedback(row: Record<string, unknown>): boolean {
  const text = objectText(row);
  const rating =
    parseNumber((row as any).rating) ??
    parseNumber((row as any).score) ??
    parseNumber((row as any).value);
  return (
    text.includes("thumbs_down") ||
    text.includes("negative") ||
    text.includes("bad") ||
    text.includes("incorrect") ||
    text.includes("not helpful") ||
    (rating != null && rating <= 2)
  );
}

function isEvalFailure(row: Record<string, unknown>): boolean {
  const text = objectText(row);
  const score = parseNumber((row as any).score);
  return (
    text.includes('"passed":false') ||
    text.includes("failed") ||
    text.includes("failure") ||
    text.includes("regression") ||
    (score != null && score < 0.7)
  );
}

function isLowSatisfaction(row: Record<string, unknown>): boolean {
  const text = objectText(row);
  const score =
    parseNumber((row as any).score) ??
    parseNumber((row as any).satisfaction) ??
    parseNumber((row as any).value);
  return (
    text.includes("frustrat") ||
    text.includes("unsatisfied") ||
    text.includes("low") ||
    (score != null && score < 0.65)
  );
}

function reason(
  code: string,
  label: string,
  score: number,
  evidenceCount: number,
): DreamCandidateReason {
  return { code, label, score, evidenceCount };
}

function addEvidence(bucket: DreamEvidence[], input: DreamEvidence, max = 12) {
  if (bucket.length >= max) return;
  const snippet = compactText(input.snippet);
  if (!snippet.trim()) return;
  bucket.push({ ...input, snippet });
}

function analyzeThreadDebug(debug: any, sourceId: string): DreamCandidate {
  const evidence: DreamEvidence[] = [];
  const reasons: DreamCandidateReason[] = [];
  const counts: Record<string, number> = {
    explicitCorrections: 0,
    rememberRequests: 0,
    failedRuns: 0,
    toolErrors: 0,
    negativeFeedback: 0,
    evalFailures: 0,
    lowSatisfaction: 0,
    frustration: 0,
    verifiedSuccess: 0,
  };

  const thread = debug.thread;
  const threadTitle = thread.title || thread.preview || thread.id;
  const messages = Array.isArray(debug.messages) ? debug.messages : [];

  for (const message of messages) {
    const text = String(message?.text ?? "");
    if (message?.role !== "user" || !text.trim()) continue;
    const lower = text.toLowerCase();
    const isRemember =
      /\b(remember|for future|next time|from now on|always)\b/.test(lower);
    const isCorrection =
      /\b(no|actually|instead|don't|do not|never|wrong|not what i meant|you should)\b/.test(
        lower,
      );
    const isFrustration =
      /\b(frustrat|again|still|why did|keeps? doing|same mistake)\b/.test(
        lower,
      );
    if (isRemember) {
      counts.rememberRequests += 1;
      addEvidence(evidence, {
        kind: "remember-request",
        label: "User asked the agent to remember something",
        snippet: text,
        threadId: thread.id,
        threadTitle,
        messageIndex: message.index,
        createdAt: parseNumber(message.createdAt),
      });
    }
    if (isCorrection) {
      counts.explicitCorrections += 1;
      addEvidence(evidence, {
        kind: "explicit-correction",
        label: "User corrected the agent",
        snippet: text,
        threadId: thread.id,
        threadTitle,
        messageIndex: message.index,
        createdAt: parseNumber(message.createdAt),
      });
    }
    if (isFrustration) {
      counts.frustration += 1;
      addEvidence(evidence, {
        kind: "frustration",
        label: "User expressed friction or repeated failure",
        snippet: text,
        threadId: thread.id,
        threadTitle,
        messageIndex: message.index,
        createdAt: parseNumber(message.createdAt),
      });
    }
  }

  const runs = Array.isArray(debug.runs) ? debug.runs : [];
  for (const run of runs) {
    if (isFailureStatus(run?.status) || run?.abortReason) {
      counts.failedRuns += 1;
      addEvidence(evidence, {
        kind: "failed-run",
        label: "Run failed or aborted",
        snippet: `${run?.status ?? "unknown"}${run?.abortReason ? `: ${run.abortReason}` : ""}`,
        threadId: thread.id,
        threadTitle,
        runId: run?.id ?? null,
        createdAt: parseNumber(run?.completedAt ?? run?.startedAt),
      });
    }
    const events = Array.isArray(run?.events) ? run.events : [];
    for (const event of events) {
      const text = objectText(event);
      const hasToolSignal =
        text.includes("tool") &&
        (text.includes("error") ||
          text.includes("failed") ||
          text.includes("exception") ||
          text.includes("timed out"));
      if (!hasToolSignal) continue;
      counts.toolErrors += 1;
      addEvidence(evidence, {
        kind: "tool-error",
        label: "Tool call reported an error",
        snippet: text,
        threadId: thread.id,
        threadTitle,
        runId: run?.id ?? null,
      });
    }
  }

  const feedback = Array.isArray(debug.feedback) ? debug.feedback : [];
  for (const row of feedback) {
    if (!isNegativeFeedback(row)) continue;
    counts.negativeFeedback += 1;
    addEvidence(evidence, {
      kind: "negative-feedback",
      label: "Negative feedback was recorded",
      snippet: row,
      threadId: thread.id,
      threadTitle,
    });
  }

  const evals = Array.isArray(debug.evals) ? debug.evals : [];
  for (const row of evals) {
    if (!isEvalFailure(row)) continue;
    counts.evalFailures += 1;
    addEvidence(evidence, {
      kind: "eval-failure",
      label: "Evaluation failed or scored low",
      snippet: row,
      threadId: thread.id,
      threadTitle,
      runId: typeof row?.run_id === "string" ? row.run_id : null,
    });
  }

  const satisfaction = Array.isArray(debug.satisfaction)
    ? debug.satisfaction
    : [];
  for (const row of satisfaction) {
    if (!isLowSatisfaction(row)) continue;
    counts.lowSatisfaction += 1;
    addEvidence(evidence, {
      kind: "low-satisfaction",
      label: "Satisfaction signal was low",
      snippet: row,
      threadId: thread.id,
      threadTitle,
    });
  }

  const checkpoints = Array.isArray(debug.checkpoints) ? debug.checkpoints : [];
  const latestRunStatus =
    runs.length > 0 && typeof runs[0]?.status === "string"
      ? runs[0].status
      : null;
  if (
    runs.some((run: any) => isSuccessStatus(run?.status)) &&
    checkpoints.length > 0 &&
    counts.failedRuns === 0
  ) {
    counts.verifiedSuccess += 1;
    addEvidence(evidence, {
      kind: "verified-success",
      label: "Successful run produced a checkpoint",
      snippet: checkpoints[0],
      threadId: thread.id,
      threadTitle,
      runId:
        typeof checkpoints[0]?.run_id === "string"
          ? checkpoints[0].run_id
          : null,
    });
  }

  if (counts.rememberRequests) {
    reasons.push(
      reason(
        "remember-request",
        "User explicitly asked the agent to remember something",
        counts.rememberRequests * 30,
        counts.rememberRequests,
      ),
    );
  }
  if (counts.explicitCorrections) {
    reasons.push(
      reason(
        "explicit-correction",
        "User corrections should be considered for memory",
        counts.explicitCorrections * 25,
        counts.explicitCorrections,
      ),
    );
  }
  if (counts.failedRuns) {
    reasons.push(
      reason(
        "failed-run",
        "Failed or aborted runs are useful dream material",
        counts.failedRuns * 12,
        counts.failedRuns,
      ),
    );
  }
  if (counts.toolErrors) {
    reasons.push(
      reason(
        "tool-error",
        "Tool errors repeated inside the run",
        Math.min(30, counts.toolErrors * 4),
        counts.toolErrors,
      ),
    );
  }
  if (counts.negativeFeedback) {
    reasons.push(
      reason(
        "negative-feedback",
        "User feedback indicates the run may contain a lesson",
        counts.negativeFeedback * 20,
        counts.negativeFeedback,
      ),
    );
  }
  if (counts.evalFailures) {
    reasons.push(
      reason(
        "eval-failure",
        "Evaluation signals found a failure",
        counts.evalFailures * 20,
        counts.evalFailures,
      ),
    );
  }
  if (counts.lowSatisfaction || counts.frustration) {
    const total = counts.lowSatisfaction + counts.frustration;
    reasons.push(
      reason(
        "satisfaction-friction",
        "Satisfaction or user wording suggests friction",
        total * 10,
        total,
      ),
    );
  }
  if (counts.verifiedSuccess) {
    reasons.push(
      reason(
        "verified-success",
        "Successful checkpointed workflow may be worth preserving",
        8,
        counts.verifiedSuccess,
      ),
    );
  }

  const score = reasons.reduce((sum, entry) => sum + entry.score, 0);

  return {
    thread: {
      id: thread.id,
      ownerEmail: thread.ownerEmail,
      title: thread.title,
      preview: thread.preview,
      messageCount: thread.messageCount,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    },
    sourceId,
    score,
    reasons,
    evidenceCounts: counts,
    evidence,
    latestRunStatus,
  };
}

export async function listDreamCandidates(input: {
  sourceId?: string;
  query?: string;
  ownerEmail?: string;
  limit?: number;
}) {
  const sourceId = input.sourceId?.trim() || "current";
  const limit = clampLimit(input.limit);
  const search = await searchAgentThreads({
    sourceId,
    query: input.query,
    ownerEmail: input.ownerEmail,
    limit,
  });

  const inspected = await Promise.all(
    search.threads.map(async (thread) => {
      try {
        const debug = await getAgentThreadDebug({
          sourceId,
          threadId: thread.id,
          ownerEmail: input.ownerEmail,
          maxRuns: 10,
          maxEvents: 300,
          maxTraceSpans: 200,
        });
        return { candidate: analyzeThreadDebug(debug, sourceId), error: null };
      } catch (error) {
        return {
          candidate: null,
          error: {
            threadId: thread.id,
            message: String((error as Error)?.message ?? error),
          },
        };
      }
    }),
  );

  const candidates = inspected
    .map((entry) => entry.candidate)
    .filter((entry): entry is DreamCandidate => Boolean(entry))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || b.thread.updatedAt - a.thread.updatedAt,
    );

  return {
    source: search.source,
    access: search.access,
    query: search.query,
    inspectedThreadCount: search.threads.length,
    candidateCount: candidates.length,
    errors: inspected.map((entry) => entry.error).filter(Boolean),
    candidates,
  };
}

function evidenceSummary(evidence: DreamEvidence[], max = 6): string {
  return evidence
    .slice(0, max)
    .map((entry) => {
      const title = entry.threadTitle || entry.threadId;
      return `- ${entry.label} in ${title} (${entry.threadId}): ${entry.snippet}`;
    })
    .join("\n");
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "agent",
  "always",
  "because",
  "before",
  "being",
  "could",
  "dispatch",
  "doing",
  "dream",
  "found",
  "from",
  "have",
  "into",
  "just",
  "latest",
  "memory",
  "next",
  "note",
  "please",
  "proposal",
  "recent",
  "remember",
  "review",
  "should",
  "source",
  "summary",
  "that",
  "their",
  "there",
  "these",
  "thing",
  "thread",
  "threads",
  "user",
  "using",
  "with",
  "would",
]);

function emptyMemoryContext(): DreamMemoryContext {
  return {
    personalIndex: "",
    personalNotes: [],
    sharedLearnings: "",
  };
}

function normalizeMemoryText(value: string): string {
  return value
    .toLowerCase()
    .replace(/`[^`]*`/g, " ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9@._/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  const tokens = normalizeMemoryText(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

function containmentScore(needle: string, haystack: string): number {
  const needleTokens = tokenSet(needle);
  if (needleTokens.size === 0) return 0;
  const haystackTokens = tokenSet(haystack);
  let matches = 0;
  for (const token of needleTokens) {
    if (haystackTokens.has(token)) matches += 1;
  }
  return matches / needleTokens.size;
}

function hasExactSourceMatch(
  evidence: DreamEvidence[],
  content: string,
): boolean {
  const normalized = normalizeMemoryText(content);
  return evidence.some((entry) => {
    if (entry.threadId && normalized.includes(entry.threadId.toLowerCase())) {
      return true;
    }
    if (entry.runId && normalized.includes(entry.runId.toLowerCase())) {
      return true;
    }
    return false;
  });
}

function evidenceSignalText(evidence: DreamEvidence[]): string {
  return evidence.map((entry) => entry.snippet).join("\n");
}

function hasCorrectionLanguage(evidence: DreamEvidence[]): boolean {
  return evidence.some((entry) => {
    if (entry.kind !== "explicit-correction") return false;
    const text = entry.snippet.toLowerCase();
    return /\b(actually|instead|don't|do not|never|wrong|not what i meant|from now on|you should)\b/.test(
      text,
    );
  });
}

function findPersonalMemoryMatch(
  memoryContext: DreamMemoryContext,
  evidence: DreamEvidence[],
): {
  note: DreamMemoryNote;
  score: number;
  exactSource: boolean;
} | null {
  const signal = evidenceSignalText(evidence);
  let best: {
    note: DreamMemoryNote;
    score: number;
    exactSource: boolean;
  } | null = null;

  for (const note of memoryContext.personalNotes) {
    const exactSource = hasExactSourceMatch(evidence, note.content);
    const score = exactSource ? 1 : containmentScore(signal, note.content);
    if (!best || score > best.score) {
      best = { note, score, exactSource };
    }
  }

  if (!best) return null;
  if (best.exactSource || best.score >= 0.42) return best;
  return null;
}

function sharedLearningLooksCaptured(
  memoryContext: DreamMemoryContext,
  evidence: DreamEvidence[],
): boolean {
  if (!memoryContext.sharedLearnings.trim()) return false;
  if (hasExactSourceMatch(evidence, memoryContext.sharedLearnings)) return true;
  return (
    containmentScore(
      evidenceSignalText(evidence),
      memoryContext.sharedLearnings,
    ) >= 0.58
  );
}

function personalIndexLooksCaptured(
  memoryContext: DreamMemoryContext,
  evidence: DreamEvidence[],
): boolean {
  if (!memoryContext.personalIndex.trim()) return false;
  if (hasExactSourceMatch(evidence, memoryContext.personalIndex)) return true;
  return (
    containmentScore(
      evidenceSignalText(evidence),
      memoryContext.personalIndex,
    ) >= 0.72
  );
}

function proposalLooksCaptured(
  proposal: DreamProposalInput,
  memoryContext: DreamMemoryContext,
): boolean {
  if (proposal.targetType === "shared-learnings") {
    return sharedLearningLooksCaptured(memoryContext, proposal.evidence);
  }
  if (personalIndexLooksCaptured(memoryContext, proposal.evidence)) {
    return true;
  }
  const match = findPersonalMemoryMatch(memoryContext, proposal.evidence);
  return Boolean(match?.exactSource || (match && match.score >= 0.72));
}

async function loadDreamMemoryContext(
  owner: string,
): Promise<DreamMemoryContext> {
  const [index, shared, personalMetas] = await Promise.all([
    resourceGetByPath(owner, MEMORY_INDEX_PATH),
    resourceGetByPath(SHARED_OWNER, "LEARNINGS.md"),
    resourceList(owner, "memory/").catch(() => []),
  ]);
  const paths = personalMetas
    .map((entry) => entry.path)
    .filter((path) => path !== MEMORY_INDEX_PATH && path.endsWith(".md"))
    .slice(0, 30);
  const personalNotes = (
    await Promise.all(
      paths.map(async (path) => {
        const resource = await resourceGetByPath(owner, path).catch(() => null);
        if (!resource?.content) return null;
        return { path, content: resource.content };
      }),
    )
  ).filter((entry): entry is DreamMemoryNote => Boolean(entry));

  return {
    personalIndex: index?.content ?? "",
    personalNotes,
    sharedLearnings: shared?.content ?? "",
  };
}

function applyMemoryGuardrails(
  proposals: DreamProposalInput[],
  memoryContext: DreamMemoryContext,
): DreamProposalBuildResult {
  const guarded: DreamProposalInput[] = [];
  const guardrailNotes: string[] = [];

  for (const proposal of proposals) {
    if (
      proposal.targetType === "personal-memory" &&
      hasCorrectionLanguage(proposal.evidence)
    ) {
      const match = findPersonalMemoryMatch(memoryContext, proposal.evidence);
      if (match?.exactSource) {
        guardrailNotes.push(
          `Skipped duplicate proposal "${proposal.title}" because existing memory already appears to capture the source evidence.`,
        );
        continue;
      }
      if (match && match.score >= 0.42) {
        guarded.push({
          ...proposal,
          targetPath: match.note.path,
          title: "Update existing memory from recent corrections",
          summary: `Existing memory at ${match.note.path} may be stale; update it with the latest explicit correction evidence.`,
          rationale: `${proposal.rationale} A related personal memory already exists, so the dream should update it instead of creating a parallel note.`,
          content: [
            "# Dispatch Dream Memory Update",
            "",
            `Existing memory: ${match.note.path}`,
            "",
            "Recent agent runs contained newer explicit user-grounded lessons:",
            "",
            evidenceSummary(proposal.evidence, 10),
          ].join("\n"),
        });
        guardrailNotes.push(
          `Retargeted proposal "${proposal.title}" to existing memory ${match.note.path} to avoid creating a stale duplicate.`,
        );
        continue;
      }
    }

    if (proposalLooksCaptured(proposal, memoryContext)) {
      guardrailNotes.push(
        `Skipped duplicate proposal "${proposal.title}" because existing memory already appears to capture the source evidence.`,
      );
      continue;
    }

    guarded.push(proposal);
  }

  return { proposals: guarded, guardrailNotes };
}

function makeReport(input: {
  title: string;
  sourceId: string;
  query: string | null;
  candidates: DreamCandidate[];
  inspectedThreadCount: number;
  proposals: DreamProposalInput[];
  guardrailNotes?: string[];
}) {
  const lines = [
    `# ${input.title}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Source: ${input.sourceId}`,
    `Query: ${input.query || "(recent threads)"}`,
    `Inspected threads: ${input.inspectedThreadCount}`,
    `Candidates: ${input.candidates.length}`,
    `Proposals: ${input.proposals.length}`,
    "",
    "## Candidate Signals",
  ];

  if (input.candidates.length === 0) {
    lines.push("", "No dream-worthy signals were found in this pass.");
  } else {
    for (const candidate of input.candidates.slice(0, 12)) {
      lines.push(
        "",
        `### ${candidate.thread.title || candidate.thread.id}`,
        "",
        `- Thread: ${candidate.thread.id}`,
        `- Score: ${candidate.score}`,
        `- Latest run status: ${candidate.latestRunStatus || "unknown"}`,
        `- Reasons: ${candidate.reasons.map((entry) => entry.label).join("; ")}`,
        "",
        "Evidence:",
        evidenceSummary(candidate.evidence, 4) ||
          "- No compact evidence available.",
      );
    }
  }

  if (input.guardrailNotes && input.guardrailNotes.length > 0) {
    lines.push("", "## Proposal Guardrails");
    for (const note of input.guardrailNotes) {
      lines.push("", `- ${note}`);
    }
  }

  lines.push("", "## Proposals");
  if (input.proposals.length === 0) {
    lines.push("", "No memory changes were proposed.");
  } else {
    for (const proposal of input.proposals) {
      lines.push(
        "",
        `### ${proposal.title}`,
        "",
        `- Target: ${proposal.targetType} at ${proposal.targetPath}`,
        `- Confidence: ${proposal.confidence}`,
        `- Risk: ${proposal.risk}`,
        `- Summary: ${proposal.summary}`,
        "",
        "Evidence:",
        evidenceSummary(proposal.evidence, 5),
      );
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function buildProposalInputs(
  candidates: DreamCandidate[],
  memoryContext: DreamMemoryContext = emptyMemoryContext(),
): DreamProposalBuildResult {
  const proposals: DreamProposalInput[] = [];
  const explicitEvidence = candidates.flatMap((candidate) =>
    candidate.evidence.filter((entry) =>
      ["remember-request", "explicit-correction"].includes(entry.kind),
    ),
  );
  const failureEvidence = candidates.flatMap((candidate) =>
    candidate.evidence.filter((entry) =>
      [
        "failed-run",
        "tool-error",
        "negative-feedback",
        "eval-failure",
        "low-satisfaction",
        "frustration",
      ].includes(entry.kind),
    ),
  );
  const successEvidence = candidates.flatMap((candidate) =>
    candidate.evidence.filter((entry) => entry.kind === "verified-success"),
  );
  const date = today();

  if (explicitEvidence.length > 0) {
    const title = `Dispatch dream memory ${date}`;
    proposals.push({
      targetType: "personal-memory",
      targetPath: `memory/${slugify(title)}.md`,
      title: "Save explicit user corrections from recent agent runs",
      summary:
        "Recent threads contain explicit user corrections or remember requests that may be worth preserving as personal memory.",
      rationale:
        "Explicit user corrections and remember requests are high-signal, user-grounded evidence for personal memory.",
      content: [
        "# Dispatch Dream Memory",
        "",
        "Recent agent runs contained explicit user-grounded lessons:",
        "",
        evidenceSummary(explicitEvidence, 10),
      ].join("\n"),
      evidence: explicitEvidence.slice(0, 10),
      confidence: Math.min(95, 70 + explicitEvidence.length * 5),
      risk: "low",
    });
  }

  const failureThreadCount = new Set(
    failureEvidence.map((entry) => entry.threadId),
  ).size;
  if (failureEvidence.length >= 2 && failureThreadCount >= 2) {
    proposals.push({
      targetType: "shared-learnings",
      targetPath: "LEARNINGS.md",
      title: "Record recurring Dispatch agent-run failure patterns",
      summary:
        "Multiple recent threads show failure, tool-error, eval, or satisfaction signals that should be reviewed as a team learning.",
      rationale:
        "Repeated grounded failure signals across more than one thread are good candidates for shared learnings, but remain pending for review.",
      content: [
        "Recent Dispatch dream review found recurring agent-run failure signals.",
        "",
        evidenceSummary(failureEvidence, 8),
      ].join("\n"),
      evidence: failureEvidence.slice(0, 8),
      confidence: Math.min(85, 50 + failureThreadCount * 10),
      risk: "medium",
    });
  }

  if (
    proposals.length === 0 &&
    successEvidence.length >= 2 &&
    new Set(successEvidence.map((entry) => entry.threadId)).size >= 2
  ) {
    proposals.push({
      targetType: "personal-memory",
      targetPath: `memory/${slugify(`dispatch-success-patterns-${date}`)}.md`,
      title: "Preserve successful Dispatch workflow patterns",
      summary:
        "Recent successful checkpointed runs may contain reusable workflow patterns.",
      rationale:
        "Checkpointed successful runs are lower-risk candidates for personal memory when no correction or failure proposals are present.",
      content: [
        "# Successful Dispatch Patterns",
        "",
        "Recent checkpointed runs worth reviewing:",
        "",
        evidenceSummary(successEvidence, 8),
      ].join("\n"),
      evidence: successEvidence.slice(0, 8),
      confidence: 60,
      risk: "low",
    });
  }

  return applyMemoryGuardrails(proposals, memoryContext);
}

function summarizeDream(
  candidates: DreamCandidate[],
  proposals: number,
): string {
  if (candidates.length === 0) {
    return "No dream-worthy signals were found in the inspected threads.";
  }
  const topReason = candidates[0]?.reasons[0]?.label ?? "agent-run signals";
  return `Reviewed ${candidates.length} candidate thread(s), led by ${topReason}. Created ${proposals} proposal(s).`;
}

function serializeProposal(row: DreamProposalRow) {
  return {
    ...row,
    evidence: safeJsonParse<DreamEvidence[]>(row.evidence, []),
  };
}

function serializeDream(row: DreamRow) {
  return row;
}

async function getDreamRow(
  dreamId: string,
  ctx: DispatchCtx = { ownerEmail: currentOwnerEmail(), orgId: currentOrgId() },
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dispatchDreams)
    .where(
      and(
        eq(schema.dispatchDreams.id, dreamId),
        scopeFor(schema.dispatchDreams, ctx),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function getProposalRow(
  proposalId: string,
  ctx: DispatchCtx = { ownerEmail: currentOwnerEmail(), orgId: currentOrgId() },
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dispatchDreamProposals)
    .where(
      and(
        eq(schema.dispatchDreamProposals.id, proposalId),
        scopeFor(schema.dispatchDreamProposals, ctx),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createDreamReport(input: {
  sourceId?: string;
  query?: string;
  ownerEmail?: string;
  limit?: number;
  title?: string;
}) {
  const db = getDb();
  const timestamp = now();
  const ownerEmail = currentOwnerEmail();
  const orgId = currentOrgId();
  const dreamId = id();
  const sourceId = input.sourceId?.trim() || "current";
  const query = input.query?.trim() || null;
  const title = input.title?.trim() || `Dispatch dream ${today()}`;

  await db.insert(schema.dispatchDreams).values({
    id: dreamId,
    ownerEmail,
    orgId,
    sourceId,
    title,
    status: "running" satisfies DreamStatus,
    query,
    report: null,
    summary: null,
    candidateCount: 0,
    inspectedThreadCount: 0,
    createdBy: ownerEmail,
    error: null,
    startedAt: timestamp,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  try {
    const result = await listDreamCandidates({
      sourceId,
      query: input.query,
      ownerEmail: input.ownerEmail,
      limit: input.limit,
    });
    const memoryContext = await loadDreamMemoryContext(ownerEmail).catch(() =>
      emptyMemoryContext(),
    );
    const proposalBuild = buildProposalInputs(result.candidates, memoryContext);
    const proposalInputs = proposalBuild.proposals;
    const report = makeReport({
      title,
      sourceId,
      query,
      candidates: result.candidates,
      inspectedThreadCount: result.inspectedThreadCount,
      proposals: proposalInputs,
      guardrailNotes: proposalBuild.guardrailNotes,
    });
    const summary = summarizeDream(result.candidates, proposalInputs.length);
    const completedAt = now();

    if (proposalInputs.length > 0) {
      await db.insert(schema.dispatchDreamProposals).values(
        proposalInputs.map((proposal) => ({
          id: id(),
          dreamId,
          ownerEmail,
          orgId,
          targetType: proposal.targetType,
          targetPath: proposal.targetPath,
          title: proposal.title,
          summary: proposal.summary,
          rationale: proposal.rationale,
          content: proposal.content,
          evidence: safeJson(proposal.evidence),
          confidence: proposal.confidence,
          risk: proposal.risk,
          status: "pending" satisfies ProposalStatus,
          appliedBy: null,
          appliedAt: null,
          rejectedBy: null,
          rejectedAt: null,
          createdAt: completedAt,
          updatedAt: completedAt,
        })),
      );
    }

    await db
      .update(schema.dispatchDreams)
      .set({
        status: "completed" satisfies DreamStatus,
        report,
        summary,
        candidateCount: result.candidateCount,
        inspectedThreadCount: result.inspectedThreadCount,
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(schema.dispatchDreams.id, dreamId));

    await recordAudit({
      action: "dream.created",
      targetType: "dream",
      targetId: dreamId,
      summary,
      metadata: {
        sourceId,
        query,
        candidates: result.candidateCount,
        inspectedThreads: result.inspectedThreadCount,
        proposals: proposalInputs.length,
      },
    });

    return getDream(dreamId);
  } catch (error) {
    const failedAt = now();
    const message = String((error as Error)?.message ?? error);
    await db
      .update(schema.dispatchDreams)
      .set({
        status: "failed" satisfies DreamStatus,
        error: message,
        completedAt: failedAt,
        updatedAt: failedAt,
      })
      .where(eq(schema.dispatchDreams.id, dreamId));
    await recordAudit({
      action: "dream.failed",
      targetType: "dream",
      targetId: dreamId,
      summary: `Dream report failed: ${message}`,
      metadata: { sourceId, query },
    });
    throw error;
  }
}

export async function listDreams(
  input: {
    limit?: number;
    status?: DreamStatus | "all";
  } = {},
) {
  const db = getDb();
  const ctx = { ownerEmail: currentOwnerEmail(), orgId: currentOrgId() };
  const limit = Math.max(1, Math.min(100, input.limit ?? 25));
  const filters = [scopeFor(schema.dispatchDreams, ctx)];
  if (input.status && input.status !== "all") {
    filters.push(eq(schema.dispatchDreams.status, input.status));
  }
  const dreams = await db
    .select()
    .from(schema.dispatchDreams)
    .where(and(...filters))
    .orderBy(desc(schema.dispatchDreams.updatedAt))
    .limit(limit);

  const dreamIds = dreams.map((dream) => dream.id);
  const proposals =
    dreamIds.length === 0
      ? []
      : await db
          .select()
          .from(schema.dispatchDreamProposals)
          .where(inArray(schema.dispatchDreamProposals.dreamId, dreamIds));

  const counts = new Map<string, Record<string, number>>();
  for (const proposal of proposals) {
    const existing = counts.get(proposal.dreamId) ?? {};
    existing[proposal.status] = (existing[proposal.status] ?? 0) + 1;
    existing.total = (existing.total ?? 0) + 1;
    counts.set(proposal.dreamId, existing);
  }

  return {
    count: dreams.length,
    dreams: dreams.map((dream) => ({
      ...serializeDream(dream),
      proposalCounts: counts.get(dream.id) ?? { total: 0 },
    })),
  };
}

export async function getDream(dreamId: string) {
  const db = getDb();
  const dream = await getDreamRow(dreamId);
  if (!dream) throw new Error("Dream not found");
  const proposals = await db
    .select()
    .from(schema.dispatchDreamProposals)
    .where(eq(schema.dispatchDreamProposals.dreamId, dream.id))
    .orderBy(desc(schema.dispatchDreamProposals.createdAt));

  return {
    dream: serializeDream(dream),
    proposals: proposals.map(serializeProposal),
  };
}

async function savePersonalMemory(proposal: DreamProposalRow) {
  if (proposal.targetType !== "personal-memory") {
    throw new Error("Proposal is not a personal-memory proposal");
  }
  const owner = proposal.ownerEmail;
  if (owner !== currentOwnerEmail()) {
    throw new Error("Personal memory proposals can only be applied by owner");
  }
  const targetPath = proposal.targetPath.startsWith("memory/")
    ? proposal.targetPath
    : `memory/${slugify(proposal.title)}.md`;
  if (targetPath === MEMORY_INDEX_PATH || !targetPath.endsWith(".md")) {
    throw new Error("Personal memory proposals must target memory/<name>.md");
  }
  const name = targetPath.replace(/^memory\//, "").replace(/\.md$/, "");
  const date = today();
  const description = compactText(proposal.summary, 140);
  const evidence = safeJsonParse<DreamEvidence[]>(proposal.evidence, []);
  const fileContent = [
    "---",
    "type: feedback",
    `description: ${JSON.stringify(description.replace(/\n/g, " "))}`,
    `updated: ${date}`,
    "---",
    "",
    proposal.content.trim(),
    "",
    "## Provenance",
    "",
    `Dream: ${proposal.dreamId}`,
    `Proposal: ${proposal.id}`,
    "",
    evidenceSummary(evidence, 10),
    "",
  ].join("\n");

  await resourcePut(owner, targetPath, fileContent, "text/markdown", {
    createdBy: "agent",
    metadata: { dreamId: proposal.dreamId, proposalId: proposal.id },
  });

  const existingIndex = await resourceGetByPath(owner, MEMORY_INDEX_PATH);
  const index = existingIndex?.content ?? "# Memory Index\n";
  const entryLine = `- [${name}](${name}.md) — ${description}`;
  const entryPrefix = `- [${name}]`;
  let found = false;
  const lines = index.split("\n").map((line) => {
    if (line.startsWith(entryPrefix)) {
      found = true;
      return entryLine;
    }
    return line;
  });
  if (!found) lines.push(entryLine);
  const updatedIndex = lines.join("\n").trimEnd() + "\n";

  await resourcePut(owner, MEMORY_INDEX_PATH, updatedIndex, "text/markdown", {
    createdBy: "agent",
    metadata: { dreamId: proposal.dreamId, proposalId: proposal.id },
  });

  return {
    resourcePath: targetPath,
    indexPath: MEMORY_INDEX_PATH,
    indexLineCount: updatedIndex.split("\n").length,
  };
}

async function appendSharedLearning(proposal: DreamProposalRow) {
  if (proposal.targetType !== "shared-learnings") {
    throw new Error("Proposal is not a shared-learnings proposal");
  }
  const evidence = safeJsonParse<DreamEvidence[]>(proposal.evidence, []);
  const existing = await resourceGetByPath(SHARED_OWNER, "LEARNINGS.md");
  const current =
    existing?.content ??
    "# Learnings\n\n## Preferences\n\n## Corrections\n\n## Patterns\n";
  const sources = [...new Set(evidence.map((entry) => entry.threadId))]
    .slice(0, 6)
    .join(", ");
  const entry = [
    `- ${today()}: ${compactText(proposal.summary, 220)}`,
    `  Source dream: ${proposal.dreamId}; source threads: ${sources || "none recorded"}.`,
  ].join("\n");
  const updated = current.includes("## Patterns")
    ? current.replace("## Patterns", `## Patterns\n\n${entry}`)
    : `${current.trimEnd()}\n\n## Patterns\n\n${entry}\n`;

  await resourcePut(SHARED_OWNER, "LEARNINGS.md", updated, "text/markdown", {
    createdBy: "agent",
    metadata: { dreamId: proposal.dreamId, proposalId: proposal.id },
  });

  return {
    resourcePath: "LEARNINGS.md",
    owner: SHARED_OWNER,
  };
}

export async function applyDreamProposal(proposalId: string) {
  const db = getDb();
  const proposal = await getProposalRow(proposalId);
  if (!proposal) throw new Error("Dream proposal not found");
  if (proposal.status !== "pending") {
    throw new Error("Only pending dream proposals can be applied");
  }

  let result: unknown;
  if (proposal.targetType === "personal-memory") {
    result = await savePersonalMemory(proposal);
  } else if (proposal.targetType === "shared-learnings") {
    result = await appendSharedLearning(proposal);
  } else {
    throw new Error(
      `Unsupported dream proposal target: ${proposal.targetType}`,
    );
  }

  const timestamp = now();
  await db
    .update(schema.dispatchDreamProposals)
    .set({
      status: "applied" satisfies ProposalStatus,
      appliedBy: currentOwnerEmail(),
      appliedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(schema.dispatchDreamProposals.id, proposal.id));

  await recordAudit({
    action: "dream.proposal.applied",
    targetType: "dream-proposal",
    targetId: proposal.id,
    summary: `Applied dream proposal: ${proposal.title}`,
    metadata: {
      dreamId: proposal.dreamId,
      targetType: proposal.targetType,
      targetPath: proposal.targetPath,
      result,
    },
  });

  return {
    proposal: serializeProposal((await getProposalRow(proposal.id))!),
    result,
  };
}

export async function rejectDreamProposal(
  proposalId: string,
  reason?: string | null,
) {
  const db = getDb();
  const proposal = await getProposalRow(proposalId);
  if (!proposal) throw new Error("Dream proposal not found");
  if (proposal.status !== "pending") {
    throw new Error("Only pending dream proposals can be rejected");
  }
  const timestamp = now();
  await db
    .update(schema.dispatchDreamProposals)
    .set({
      status: "rejected" satisfies ProposalStatus,
      rejectedBy: currentOwnerEmail(),
      rejectedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(schema.dispatchDreamProposals.id, proposal.id));

  await recordAudit({
    action: "dream.proposal.rejected",
    targetType: "dream-proposal",
    targetId: proposal.id,
    summary: `Rejected dream proposal: ${proposal.title}`,
    metadata: {
      dreamId: proposal.dreamId,
      reason: reason || null,
    },
  });

  return serializeProposal((await getProposalRow(proposal.id))!);
}

function cronLooksValid(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((part) => /^[\d*/,\-]+$/.test(part));
}

function dreamJobBody(sourceId: string, query: string | null, limit: number) {
  const queryLine = query
    ? `- Use query "${query}" to focus the dream pass.`
    : "- Review recent threads without a search query.";
  return `# Dispatch Dream

Run a safe Dispatch dreaming pass.

1. Call \`create-dream-report\` with:
   - sourceId: "${sourceId}"
   ${queryLine}
   - limit: ${limit}
2. Review the returned proposals and evidence.
3. Do not auto-apply shared/team changes, AGENTS.md changes, skills, or jobs.
4. Only apply personal-memory proposals when the evidence is explicit user-grounded correction or a remember request.
5. Leave all other proposals pending for a human to review.
`;
}

export async function ensureDreamJob(input: {
  schedule?: string;
  sourceId?: string;
  query?: string;
  limit?: number;
}) {
  const schedule = input.schedule?.trim() || DEFAULT_DREAM_CRON;
  if (!cronLooksValid(schedule)) {
    throw new Error(
      'Invalid cron expression. Use a standard five-field cron like "0 9 * * 1".',
    );
  }
  const owner = currentOwnerEmail();
  const orgId = currentOrgId();
  const sourceId = input.sourceId?.trim() || "current";
  const limit = clampLimit(input.limit);
  const content = [
    "---",
    `schedule: "${schedule}"`,
    "enabled: true",
    `createdBy: ${owner}`,
    ...(orgId ? [`orgId: ${orgId}`] : []),
    "runAs: creator",
    "---",
    "",
    dreamJobBody(sourceId, input.query?.trim() || null, limit),
  ].join("\n");

  const resource = await resourcePut(
    owner,
    DREAM_JOB_PATH,
    content,
    "text/markdown",
    {
      createdBy: "agent",
      metadata: { sourceId, query: input.query?.trim() || null, limit },
    },
  );

  await recordAudit({
    action: "dream.job.ensured",
    targetType: "job",
    targetId: DREAM_JOB_PATH,
    summary: "Ensured weekly Dispatch dream recurring job",
    metadata: { schedule, sourceId, query: input.query?.trim() || null, limit },
  });

  return {
    path: resource.path,
    owner: resource.owner,
    schedule,
    enabled: true,
    runAs: "creator",
    sourceId,
    query: input.query?.trim() || null,
    limit,
  };
}
