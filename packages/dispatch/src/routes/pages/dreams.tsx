import { useEffect, useMemo, useState } from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { toast } from "sonner";
import {
  IconAlertTriangle,
  IconBrain,
  IconCheck,
  IconCircleDashed,
  IconClock,
  IconPlayerPlay,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { DispatchShell } from "@/components/dispatch-shell";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: "Dreams — Dispatch" }];
}

type DreamStatus =
  | "running"
  | "completed"
  | "failed"
  | "pending"
  | "applied"
  | "rejected"
  | "stale"
  | string;

interface DreamPass {
  id: string;
  title?: string | null;
  summary?: string | null;
  status?: DreamStatus | null;
  sourceId?: string | null;
  query?: string | null;
  error?: string | null;
  createdAt?: number | string | null;
  startedAt?: number | string | null;
  completedAt?: number | string | null;
  updatedAt?: number | string | null;
  candidateCount?: number | null;
  inspectedThreadCount?: number | null;
  inspectedRunCount?: number | null;
  proposalCount?: number | null;
  proposalCounts?: Record<string, number> | null;
  appliedCount?: number | null;
  rejectedCount?: number | null;
}

interface DreamEvidence {
  id?: string | null;
  label?: string | null;
  title?: string | null;
  source?: string | null;
  sourceId?: string | null;
  threadId?: string | null;
  threadTitle?: string | null;
  runId?: string | null;
  kind?: string | null;
  quote?: string | null;
  snippet?: string | null;
  summary?: string | null;
  confidence?: number | null;
  createdAt?: number | string | null;
  [key: string]: unknown;
}

interface DreamProposal {
  id: string;
  dreamId?: string | null;
  title?: string | null;
  summary?: string | null;
  status?: DreamStatus | null;
  targetType?: string | null;
  targetPath?: string | null;
  type?: string | null;
  target?: string | null;
  path?: string | null;
  risk?: string | null;
  confidence?: number | null;
  rationale?: string | null;
  content?: string | null;
  evidence?: DreamEvidence[] | null;
  sourceRunIds?: string[] | null;
  createdAt?: number | string | null;
}

interface CandidateRun {
  id?: string;
  thread?: {
    id: string;
    ownerEmail: string;
    title: string;
    preview: string;
    messageCount: number;
    createdAt: number;
    updatedAt: number;
  };
  title?: string | null;
  summary?: string | null;
  preview?: string | null;
  ownerEmail?: string | null;
  sourceId?: string | null;
  sourceLabel?: string | null;
  threadId?: string | null;
  runId?: string | null;
  status?: string | null;
  score?: number | null;
  reasons?:
    | string[]
    | Array<{
        code: string;
        label: string;
        score: number;
        evidenceCount: number;
      }>
    | null;
  signals?: string[] | null;
  latestRunStatus?: string | null;
  updatedAt?: number | string | null;
  startedAt?: number | string | null;
  completedAt?: number | string | null;
  evidence?: DreamEvidence[] | null;
}

interface DreamDetail {
  dream?: DreamPass | null;
  report?: string | null;
  summary?: string | null;
  proposals?: DreamProposal[] | null;
  candidates?: CandidateRun[] | null;
  inspectedRuns?: CandidateRun[] | null;
  evidence?: DreamEvidence[] | null;
  [key: string]: unknown;
}

type ListDreamsResponse =
  | DreamPass[]
  | {
      dreams?: DreamPass[];
      items?: DreamPass[];
      results?: DreamPass[];
    };

type ListCandidatesResponse =
  | CandidateRun[]
  | {
      candidates?: CandidateRun[];
      items?: CandidateRun[];
      results?: CandidateRun[];
    };

type GetDreamResponse = DreamDetail | null;

interface CreateDreamReportParams {
  sourceId?: string;
  query?: string;
  ownerEmail?: string;
  limit?: number;
  title?: string;
}

interface CreateDreamReportResult {
  id?: string;
  dreamId?: string;
  dream?: DreamPass;
}

interface ProposalMutationParams {
  id: string;
}

function normalizeArray<T>(value: unknown, keys: readonly string[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }
  return [];
}

function formatDate(value: number | string | null | undefined): string {
  if (value == null || value === "") return "n/a";
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
}

function compactDate(value: number | string | null | undefined): string {
  if (value == null || value === "") return "n/a";
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

function dreamLabel(dream: DreamPass, index: number): string {
  return dream.title || `Dream pass ${index + 1}`;
}

function proposalTarget(proposal: DreamProposal): string {
  return (
    proposal.targetPath ||
    proposal.path ||
    proposal.target ||
    proposal.targetType ||
    proposal.type ||
    "memory"
  );
}

function evidenceLabel(evidence: DreamEvidence, index: number): string {
  return (
    evidence.label ||
    evidence.title ||
    evidence.threadTitle ||
    evidence.source ||
    evidence.threadId ||
    evidence.runId ||
    `Evidence ${index + 1}`
  );
}

function candidateLabel(candidate: CandidateRun): string {
  return (
    candidate.thread?.title ||
    candidate.title ||
    candidate.summary ||
    candidate.thread?.preview ||
    candidate.preview ||
    candidate.thread?.id ||
    candidate.threadId ||
    candidate.runId ||
    candidate.id ||
    "candidate"
  );
}

function candidateSignals(candidate: CandidateRun): string[] {
  const reasons = (candidate.reasons ?? []).map((reason) =>
    typeof reason === "string" ? reason : reason.label,
  );
  return [...reasons, ...(candidate.signals ?? [])].filter(Boolean);
}

function candidateId(candidate: CandidateRun): string {
  return (
    candidate.id ||
    candidate.thread?.id ||
    candidate.threadId ||
    candidate.runId ||
    candidateLabel(candidate)
  );
}

function candidateStatus(candidate: CandidateRun): string {
  return candidate.latestRunStatus || candidate.status || "unknown";
}

function candidateOwner(candidate: CandidateRun): string {
  return candidate.thread?.ownerEmail || candidate.ownerEmail || "n/a";
}

function candidateUpdatedAt(candidate: CandidateRun): number | string | null {
  return (
    candidate.updatedAt ||
    candidate.completedAt ||
    candidate.startedAt ||
    candidate.thread?.updatedAt ||
    null
  );
}

function dreamProposalCount(dream: DreamPass): number {
  return dream.proposalCount ?? dream.proposalCounts?.total ?? 0;
}

function dreamInspectedCount(dream: DreamPass): number {
  return dream.inspectedThreadCount ?? dream.inspectedRunCount ?? 0;
}

function resultDreamId(result: CreateDreamReportResult | null | undefined) {
  return result?.dream?.id || result?.dreamId || result?.id || null;
}

function statusVariant(status: DreamStatus | null | undefined) {
  const normalized = String(status || "pending").toLowerCase();
  if (normalized === "failed") return "destructive" as const;
  if (normalized === "completed" || normalized === "applied")
    return "default" as const;
  if (normalized === "rejected" || normalized === "stale")
    return "outline" as const;
  return "secondary" as const;
}

function StatusBadge({ status }: { status?: DreamStatus | null }) {
  const normalized = String(status || "pending").toLowerCase();
  return (
    <Badge variant={statusVariant(status)} className="capitalize">
      {normalized.replace(/_/g, " ")}
    </Badge>
  );
}

function isApprovalRequestResult(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const result = record.result as Record<string, unknown> | undefined;
  return result?.approvalRequired === true;
}

function QueryState({ error, label }: { error: unknown; label: string }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <IconAlertTriangle className="h-4 w-4" />
      <AlertTitle>{label}</AlertTitle>
      <AlertDescription>
        {error instanceof Error ? error.message : String(error)}
      </AlertDescription>
    </Alert>
  );
}

function RawBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words">
      {typeof value === "string" ? value : json(value)}
    </pre>
  );
}

function EmptyPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
        {description}
      </div>
    </div>
  );
}

function DreamListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="rounded-lg border p-3">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-2 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function ProposalSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-lg border p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof IconBrain;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {value}
          </div>
        </div>
        <Icon size={18} className="text-muted-foreground" />
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  applying,
  rejecting,
  onApply,
  onReject,
}: {
  proposal: DreamProposal;
  applying: boolean;
  rejecting: boolean;
  onApply: () => void;
  onReject: () => void;
}) {
  const evidence = proposal.evidence ?? [];
  const sourceRunIds = proposal.sourceRunIds ?? [];
  const status = String(proposal.status || "pending").toLowerCase();
  const canAct = status === "pending";
  const needsApproval =
    proposal.targetType != null && proposal.targetType !== "personal-memory";

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={proposal.status} />
            <Badge variant="outline" className="font-mono">
              {proposalTarget(proposal)}
            </Badge>
            {proposal.risk ? (
              <Badge variant="secondary" className="capitalize">
                {proposal.risk} risk
              </Badge>
            ) : null}
          </div>
          <div className="mt-2 text-sm font-medium text-foreground">
            {proposal.title || proposal.summary || proposal.id}
          </div>
          {proposal.summary && proposal.title ? (
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {proposal.summary}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            disabled={!canAct || applying || rejecting}
            onClick={onApply}
          >
            {applying ? (
              <Spinner className="mr-1.5 size-3.5" />
            ) : (
              <IconCheck size={14} className="mr-1.5" />
            )}
            {needsApproval ? "Request approval" : "Apply"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canAct || applying || rejecting}
            onClick={onReject}
          >
            {rejecting ? (
              <Spinner className="mr-1.5 size-3.5" />
            ) : (
              <IconX size={14} className="mr-1.5" />
            )}
            Reject
          </Button>
        </div>
      </div>

      <Accordion type="multiple" className="px-4">
        <AccordionItem value="evidence" className="border-b-0">
          <AccordionTrigger className="py-3 text-xs hover:no-underline">
            Evidence and provenance
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pb-4">
            {sourceRunIds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {sourceRunIds.map((id) => (
                  <Badge key={id} variant="outline" className="font-mono">
                    {id}
                  </Badge>
                ))}
              </div>
            ) : null}
            {evidence.length > 0 ? (
              <div className="space-y-2">
                {evidence.map((item, index) => (
                  <div
                    key={item.id || `${proposal.id}-evidence-${index}`}
                    className="rounded-md border bg-muted/20 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-medium text-foreground">
                        {evidenceLabel(item, index)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatDate(item.createdAt)}
                      </div>
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {item.quote || item.snippet || item.summary || "No text"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                No structured evidence attached yet.
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
        {proposal.content ? (
          <AccordionItem value="content" className="border-b-0">
            <AccordionTrigger className="py-3 text-xs hover:no-underline">
              Proposed content
            </AccordionTrigger>
            <AccordionContent className="pb-4">
              <RawBlock value={proposal.content} />
            </AccordionContent>
          </AccordionItem>
        ) : null}
      </Accordion>
    </div>
  );
}

export default function DreamsRoute() {
  const [selectedDreamId, setSelectedDreamId] = useState<string | null>(null);

  const dreamsQuery = useActionQuery<ListDreamsResponse>(
    "list-dreams",
    { limit: 25 },
    { staleTime: 15_000 },
  );
  const candidatesQuery = useActionQuery<ListCandidatesResponse>(
    "list-dream-candidates",
    { limit: 25 },
    { staleTime: 15_000 },
  );
  const dreamDetailQuery = useActionQuery<GetDreamResponse>(
    "get-dream",
    { id: selectedDreamId ?? "" },
    { enabled: !!selectedDreamId, staleTime: 10_000 },
  );

  const dreams = useMemo(
    () =>
      normalizeArray<DreamPass>(dreamsQuery.data, [
        "dreams",
        "items",
        "results",
      ]),
    [dreamsQuery.data],
  );
  const candidates = useMemo(
    () =>
      normalizeArray<CandidateRun>(candidatesQuery.data, [
        "candidates",
        "items",
        "results",
      ]),
    [candidatesQuery.data],
  );

  useEffect(() => {
    if (selectedDreamId && dreams.some((dream) => dream.id === selectedDreamId))
      return;
    setSelectedDreamId(dreams[0]?.id ?? null);
  }, [dreams, selectedDreamId]);

  const createDream = useActionMutation<
    CreateDreamReportResult,
    CreateDreamReportParams
  >("create-dream-report", {
    onSuccess: (result) => {
      const nextId = resultDreamId(result);
      if (nextId) setSelectedDreamId(nextId);
      toast.success("Dream report created");
    },
    onError: (err) => toast.error(String(err)),
  });

  const applyProposal = useActionMutation<unknown, ProposalMutationParams>(
    "apply-dream-proposal",
    {
      onSuccess: (result) =>
        toast.success(
          isApprovalRequestResult(result)
            ? "Approval requested"
            : "Proposal applied",
        ),
      onError: (err) => toast.error(String(err)),
    },
  );

  const rejectProposal = useActionMutation<unknown, ProposalMutationParams>(
    "reject-dream-proposal",
    {
      onSuccess: () => toast.success("Proposal rejected"),
      onError: (err) => toast.error(String(err)),
    },
  );

  const detail = dreamDetailQuery.data ?? null;
  const selectedDream =
    detail?.dream ?? dreams.find((dream) => dream.id === selectedDreamId);
  const proposals = detail?.proposals ?? [];
  const inspectedRuns = detail?.inspectedRuns ?? detail?.candidates ?? [];
  const pendingProposalCount = proposals.filter(
    (proposal) => String(proposal.status || "pending") === "pending",
  ).length;
  const appliedProposalCount = proposals.filter(
    (proposal) => String(proposal.status || "").toLowerCase() === "applied",
  ).length;

  function runDream() {
    createDream.mutate({
      limit: candidates.length > 0 ? candidates.length : 20,
    });
  }

  return (
    <DispatchShell
      title="Dreams"
      description="Review agent runs, propose memory improvements, and apply evidence-backed learning changes."
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="grid flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Dream passes"
              value={dreams.length}
              icon={IconBrain}
            />
            <StatTile
              label="Pending proposals"
              value={pendingProposalCount}
              icon={IconCircleDashed}
            />
            <StatTile
              label="Candidate runs"
              value={candidates.length}
              icon={IconClock}
            />
            <StatTile
              label="Inspected threads"
              value={selectedDream ? dreamInspectedCount(selectedDream) : 0}
              icon={IconCheck}
            />
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              onClick={() => {
                dreamsQuery.refetch();
                candidatesQuery.refetch();
                if (selectedDreamId) dreamDetailQuery.refetch();
              }}
            >
              <IconRefresh size={15} className="mr-1.5" />
              Refresh
            </Button>
            <Button onClick={runDream} disabled={createDream.isPending}>
              {createDream.isPending ? (
                <Spinner className="mr-1.5 size-3.5" />
              ) : (
                <IconPlayerPlay size={15} className="mr-1.5" />
              )}
              Run dream
            </Button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_380px]">
          <section className="rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <div className="text-sm font-semibold text-foreground">
                Recent passes
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Reports generated from prior agent activity.
              </div>
            </div>
            <div className="max-h-[720px] overflow-auto p-3">
              <QueryState
                error={dreamsQuery.error}
                label="Could not load dream passes"
              />
              {dreamsQuery.isLoading ? <DreamListSkeleton /> : null}
              {!dreamsQuery.isLoading && !dreamsQuery.error ? (
                dreams.length > 0 ? (
                  <div className="space-y-2">
                    {dreams.map((dream, index) => {
                      const selected = dream.id === selectedDreamId;
                      return (
                        <button
                          key={dream.id}
                          type="button"
                          onClick={() => setSelectedDreamId(dream.id)}
                          className={cn(
                            "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                            selected
                              ? "border-foreground bg-muted"
                              : "bg-background hover:border-foreground/30 hover:bg-muted/40",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">
                                {dreamLabel(dream, index)}
                              </div>
                              <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                                {dream.id}
                              </div>
                            </div>
                            <StatusBadge status={dream.status} />
                          </div>
                          <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {dream.summary || "No summary yet."}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <Badge variant="outline">
                              {plural(dreamProposalCount(dream), "proposal")}
                            </Badge>
                            <Badge variant="outline">
                              {plural(dreamInspectedCount(dream), "run")}
                            </Badge>
                          </div>
                          <div className="mt-2 text-[11px] text-muted-foreground">
                            {compactDate(
                              dream.completedAt ??
                                dream.updatedAt ??
                                dream.startedAt ??
                                dream.createdAt,
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyPanel
                    title="No dreams yet"
                    description="Run the first dream pass to review recent agent history and generate proposed memory changes."
                  />
                )
              ) : null}
            </div>
          </section>

          <section className="min-w-0 rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {selectedDream
                      ? selectedDream.title || selectedDream.id
                      : "Dream detail"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {selectedDream
                      ? `Completed ${formatDate(
                          selectedDream.completedAt ??
                            selectedDream.updatedAt ??
                            selectedDream.createdAt,
                        )}`
                      : "Select a pass or run a new dream."}
                  </div>
                </div>
                {selectedDream ? (
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={selectedDream.status} />
                    <Badge variant="outline">
                      {plural(appliedProposalCount, "applied", "applied")}
                    </Badge>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="p-4">
              <QueryState
                error={dreamDetailQuery.error}
                label="Could not load dream detail"
              />
              {dreamDetailQuery.isLoading ? <ProposalSkeleton /> : null}
              {!selectedDreamId && !dreamDetailQuery.isLoading ? (
                <EmptyPanel
                  title="Nothing selected"
                  description="Choose a recent dream pass or run one from candidate agent runs."
                />
              ) : null}
              {selectedDreamId &&
              !dreamDetailQuery.isLoading &&
              !dreamDetailQuery.error ? (
                <Tabs defaultValue="proposals" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="proposals">Proposals</TabsTrigger>
                    <TabsTrigger value="report">Report</TabsTrigger>
                    <TabsTrigger value="sources">Sources</TabsTrigger>
                  </TabsList>

                  <TabsContent value="proposals" className="mt-4">
                    {proposals.length > 0 ? (
                      <div className="space-y-3">
                        {proposals.map((proposal) => (
                          <ProposalCard
                            key={proposal.id}
                            proposal={proposal}
                            applying={
                              applyProposal.isPending &&
                              applyProposal.variables?.id === proposal.id
                            }
                            rejecting={
                              rejectProposal.isPending &&
                              rejectProposal.variables?.id === proposal.id
                            }
                            onApply={() =>
                              applyProposal.mutate({
                                id: proposal.id,
                              })
                            }
                            onReject={() =>
                              rejectProposal.mutate({
                                id: proposal.id,
                              })
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyPanel
                        title="No proposals"
                        description="This dream did not produce reviewable memory, skill, job, or instruction changes."
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="report" className="mt-4">
                    {detail?.report || detail?.summary ? (
                      <RawBlock value={detail.report || detail.summary || ""} />
                    ) : (
                      <EmptyPanel
                        title="No report text"
                        description="The dream detail action did not return a report body."
                      />
                    )}
                  </TabsContent>

                  <TabsContent value="sources" className="mt-4">
                    {inspectedRuns.length > 0 || detail?.evidence?.length ? (
                      <Accordion type="multiple" className="rounded-lg border">
                        {inspectedRuns.map((run, index) => (
                          <AccordionItem
                            key={candidateId(run)}
                            value={candidateId(run) || `run-${index}`}
                            className="px-4"
                          >
                            <AccordionTrigger className="text-sm hover:no-underline">
                              <span className="min-w-0 truncate text-left">
                                {candidateLabel(run)}
                              </span>
                            </AccordionTrigger>
                            <AccordionContent className="pb-4">
                              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                                <div>
                                  Thread:{" "}
                                  <span className="font-mono text-foreground">
                                    {run.thread?.id ?? run.threadId ?? "n/a"}
                                  </span>
                                </div>
                                <div>
                                  Run:{" "}
                                  <span className="font-mono text-foreground">
                                    {run.runId ?? run.id}
                                  </span>
                                </div>
                                <div>Owner: {candidateOwner(run)}</div>
                                <div>Status: {candidateStatus(run)}</div>
                              </div>
                              {candidateSignals(run).length > 0 ? (
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                  {candidateSignals(run).map((signal) => (
                                    <Badge key={signal} variant="outline">
                                      {signal}
                                    </Badge>
                                  ))}
                                </div>
                              ) : null}
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                        {(detail?.evidence ?? []).map((item, index) => (
                          <AccordionItem
                            key={item.id || `evidence-${index}`}
                            value={item.id || `evidence-${index}`}
                            className="px-4"
                          >
                            <AccordionTrigger className="text-sm hover:no-underline">
                              {evidenceLabel(item, index)}
                            </AccordionTrigger>
                            <AccordionContent className="pb-4">
                              <RawBlock value={item} />
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    ) : (
                      <EmptyPanel
                        title="No source runs"
                        description="This dream has no structured source list yet."
                      />
                    )}
                  </TabsContent>
                </Tabs>
              ) : null}
            </div>
          </section>

          <section className="rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Candidate runs
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Grounded signals ready for review.
                </div>
              </div>
            </div>
            <div className="max-h-[720px] overflow-auto p-3">
              <QueryState
                error={candidatesQuery.error}
                label="Could not load candidates"
              />
              {candidatesQuery.isLoading ? <DreamListSkeleton /> : null}
              {!candidatesQuery.isLoading && !candidatesQuery.error ? (
                candidates.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Run</TableHead>
                        <TableHead>Signals</TableHead>
                        <TableHead className="w-20 text-right">Score</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {candidates.map((candidate) => {
                        const id = candidateId(candidate);
                        const signals = candidateSignals(candidate);
                        return (
                          <TableRow key={id}>
                            <TableCell className="min-w-0 py-3">
                              <div className="max-w-[230px] truncate text-sm font-medium text-foreground">
                                {candidateLabel(candidate)}
                              </div>
                              <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                                {candidate.thread?.id ??
                                  candidate.threadId ??
                                  candidate.runId ??
                                  id}
                              </div>
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                {candidateOwner(candidate)} ·{" "}
                                {compactDate(candidateUpdatedAt(candidate))}
                              </div>
                            </TableCell>
                            <TableCell className="py-3">
                              <div className="mt-1 flex flex-wrap gap-1">
                                <Badge variant="outline">
                                  {candidateStatus(candidate)}
                                </Badge>
                                {signals.slice(0, 2).map((signal) => (
                                  <Badge key={signal} variant="secondary">
                                    {signal}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="py-3 text-right text-sm tabular-nums text-muted-foreground">
                              {candidate.score ?? "n/a"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyPanel
                    title="No candidates"
                    description="No recent runs matched the dream candidate heuristics."
                  />
                )
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </DispatchShell>
  );
}
