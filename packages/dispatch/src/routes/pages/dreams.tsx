import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconAlertTriangle,
  IconBrain,
  IconCalendarTime,
  IconCheck,
  IconCircleDashed,
  IconClock,
  IconDatabase,
  IconFileDiff,
  IconPlayerPlay,
  IconRefresh,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  dreamSettingsToDraft,
  dreamSettingsUpdateFromDraft,
  splitSourceIds,
  type DreamSettings,
  type DreamSettingsDraft,
} from "./dream-settings";

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
  sourceHealth?: DreamSourceHealth[] | null;
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

interface DreamSourceHealth {
  sourceId: string;
  label?: string | null;
  status: "ok" | "timed_out" | "error" | string;
  startedAt?: number | string | null;
  completedAt?: number | string | null;
  durationMs: number;
  timeoutMs?: number | null;
  inspectedThreadCount: number;
  candidateCount: number;
  errorCount: number;
  threadErrorCount?: number | null;
  message?: string | null;
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
      sources?: DreamSourceHealth[];
      sourceHealth?: DreamSourceHealth[];
    };

type GetDreamResponse = DreamDetail | null;

interface CreateDreamReportParams {
  sourceId?: string;
  sourceIds?: string[];
  allSources?: boolean;
  query?: string;
  ownerEmail?: string;
  limit?: number;
  sourceTimeoutMs?: number;
  sourceConcurrency?: number;
  sourceStartStaggerMs?: number;
  threadConcurrency?: number;
  threadTimeoutMs?: number;
  title?: string;
}

interface CreateDreamReportResult {
  id?: string;
  dreamId?: string;
  dream?: DreamPass;
}

interface ProposalMutationParams {
  id: string;
  reason?: string;
}

interface DreamProposalPreview {
  operation?: "create" | "update" | "append" | string;
  targetExists?: boolean;
  currentContent?: string | null;
  proposedContent?: string | null;
  target?: {
    type?: string | null;
    path?: string | null;
    kind?: string | null;
    resourceId?: string | null;
  };
  approval?: {
    required?: boolean;
    policyEnabled?: boolean;
    willRequestApproval?: boolean;
  };
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

function normalizeSourceHealth(value: unknown): DreamSourceHealth[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.sources)) {
    return record.sources as DreamSourceHealth[];
  }
  if (Array.isArray(record.sourceHealth)) {
    return record.sourceHealth as DreamSourceHealth[];
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

function sourceStatusVariant(status: string | null | undefined) {
  const normalized = String(status || "ok").toLowerCase();
  if (normalized === "error" || normalized === "timed_out") {
    return "destructive" as const;
  }
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

function SourceHealthPanel({ sources }: { sources: DreamSourceHealth[] }) {
  if (sources.length === 0) return null;
  const unhealthyCount = sources.filter(
    (source) => String(source.status).toLowerCase() !== "ok",
  ).length;
  return (
    <Alert variant={unhealthyCount > 0 ? "destructive" : "default"}>
      <IconDatabase className="h-4 w-4" />
      <AlertTitle>Source health</AlertTitle>
      <AlertDescription>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sources.map((source) => (
            <Badge
              key={source.sourceId}
              variant={sourceStatusVariant(source.status)}
              className="gap-1"
              title={
                source.message ||
                `${source.inspectedThreadCount} inspected, ${source.candidateCount} candidates, ${source.durationMs}ms of ${source.timeoutMs ?? "n/a"}ms`
              }
            >
              {source.label || source.sourceId}:{" "}
              {String(source.status).replace(/_/g, " ")} · {source.durationMs}
              ms
            </Badge>
          ))}
        </div>
      </AlertDescription>
    </Alert>
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

function DreamSettingsSheet({
  open,
  onOpenChange,
  draft,
  onDraftChange,
  onSave,
  saving,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: DreamSettingsDraft;
  onDraftChange: (draft: DreamSettingsDraft) => void;
  onSave: () => void;
  saving: boolean;
  loading: boolean;
}) {
  const sourceIds = splitSourceIds(draft.sourceIdsText);
  const canSave = draft.schedule.trim().length > 0;

  function update<K extends keyof DreamSettingsDraft>(
    key: K,
    value: DreamSettingsDraft[K],
  ) {
    onDraftChange({ ...draft, [key]: value });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" disabled={loading}>
          <IconSettings size={15} className="mr-1.5" />
          Settings
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-5 py-4">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <Badge variant={draft.enabled ? "default" : "secondary"}>
              {draft.enabled ? "Enabled" : "Paused"}
            </Badge>
            <Badge variant="outline" className="font-mono">
              {draft.schedule || "No schedule"}
            </Badge>
          </div>
          <SheetTitle className="mt-2 text-base">Dream settings</SheetTitle>
          <SheetDescription>
            Configure recurring dream scope, schedule, and scan limits.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 p-5">
            <section className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Schedule
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/20 px-3 py-3">
                <div>
                  <Label htmlFor="dream-enabled">Recurring dreams</Label>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Saved setting used by dream jobs.
                  </div>
                </div>
                <Switch
                  id="dream-enabled"
                  checked={draft.enabled}
                  onCheckedChange={(checked) => update("enabled", checked)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                <div className="space-y-2">
                  <Label htmlFor="dream-schedule">Cron schedule</Label>
                  <Input
                    id="dream-schedule"
                    value={draft.schedule}
                    onChange={(event) => update("schedule", event.target.value)}
                    placeholder="0 9 * * 1"
                    className="font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dream-min-candidates">Min candidates</Label>
                  <Input
                    id="dream-min-candidates"
                    type="number"
                    min={0}
                    max={50}
                    value={draft.minCandidateCount}
                    onChange={(event) =>
                      update("minCandidateCount", event.target.value)
                    }
                  />
                </div>
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sources
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/20 px-3 py-3">
                <div>
                  <Label htmlFor="dream-all-sources">All sources</Label>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Scan every connected thread-debug source.
                  </div>
                </div>
                <Switch
                  id="dream-all-sources"
                  checked={draft.allSources}
                  onCheckedChange={(checked) => update("allSources", checked)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="dream-source-id">Source ID</Label>
                  <Input
                    id="dream-source-id"
                    value={draft.sourceId}
                    onChange={(event) => update("sourceId", event.target.value)}
                    disabled={draft.allSources || sourceIds.length > 0}
                    placeholder="current"
                    className="font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dream-query">Query</Label>
                  <Input
                    id="dream-query"
                    value={draft.query}
                    onChange={(event) => update("query", event.target.value)}
                    placeholder="Optional search term"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dream-source-ids">Explicit source IDs</Label>
                <Textarea
                  id="dream-source-ids"
                  value={draft.sourceIdsText}
                  onChange={(event) =>
                    update("sourceIdsText", event.target.value)
                  }
                  disabled={draft.allSources}
                  rows={3}
                  placeholder="One source ID per line"
                  className="font-mono"
                />
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Scan Limits
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="dream-limit">Candidate limit</Label>
                  <Input
                    id="dream-limit"
                    type="number"
                    min={1}
                    max={50}
                    value={draft.limit}
                    onChange={(event) => update("limit", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dream-source-timeout">
                    Source timeout ms
                  </Label>
                  <Input
                    id="dream-source-timeout"
                    type="number"
                    min={1000}
                    max={60000}
                    value={draft.sourceTimeoutMs}
                    onChange={(event) =>
                      update("sourceTimeoutMs", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dream-source-concurrency">
                    Source concurrency
                  </Label>
                  <Input
                    id="dream-source-concurrency"
                    type="number"
                    min={1}
                    max={8}
                    value={draft.sourceConcurrency}
                    onChange={(event) =>
                      update("sourceConcurrency", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dream-start-stagger">Start stagger ms</Label>
                  <Input
                    id="dream-start-stagger"
                    type="number"
                    min={0}
                    max={5000}
                    value={draft.sourceStartStaggerMs}
                    onChange={(event) =>
                      update("sourceStartStaggerMs", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dream-thread-concurrency">
                    Thread concurrency
                  </Label>
                  <Input
                    id="dream-thread-concurrency"
                    type="number"
                    min={1}
                    max={10}
                    value={draft.threadConcurrency}
                    onChange={(event) =>
                      update("threadConcurrency", event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dream-thread-timeout">
                    Thread timeout ms
                  </Label>
                  <Input
                    id="dream-thread-timeout"
                    type="number"
                    min={1000}
                    max={30000}
                    value={draft.threadTimeoutMs}
                    onChange={(event) =>
                      update("threadTimeoutMs", event.target.value)
                    }
                  />
                </div>
              </div>
            </section>
          </div>
        </ScrollArea>

        <SheetFooter className="gap-2 border-t px-5 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={!canSave || saving} onClick={onSave}>
            {saving ? <Spinner className="mr-1.5 size-3.5" /> : null}
            Save settings
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
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
  onReject: (reason?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const evidence = proposal.evidence ?? [];
  const sourceRunIds = proposal.sourceRunIds ?? [];
  const status = String(proposal.status || "pending").toLowerCase();
  const canAct = status === "pending";
  const needsApproval =
    proposal.targetType != null && proposal.targetType !== "personal-memory";
  const previewQuery = useActionQuery<DreamProposalPreview>(
    "preview-dream-proposal",
    { id: proposal.id },
    { enabled: open, staleTime: 0 },
  );
  const preview = previewQuery.data;

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
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant={canAct ? "default" : "outline"}>
                <IconFileDiff size={14} className="mr-1.5" />
                Review
              </Button>
            </SheetTrigger>
            <SheetContent className="flex w-full flex-col p-0 sm:max-w-3xl">
              <SheetHeader className="border-b px-5 py-4">
                <div className="flex flex-wrap items-center gap-2 pr-8">
                  <StatusBadge status={proposal.status} />
                  <Badge variant="outline" className="font-mono">
                    {preview?.target?.path || proposalTarget(proposal)}
                  </Badge>
                  <Badge variant="secondary" className="capitalize">
                    {preview?.operation || "review"}
                  </Badge>
                  {preview?.approval?.willRequestApproval ? (
                    <Badge variant="secondary">Approval request</Badge>
                  ) : null}
                </div>
                <SheetTitle className="mt-2 text-base">
                  {proposal.title || proposal.summary || proposal.id}
                </SheetTitle>
                <SheetDescription>
                  {proposal.summary ||
                    "Review the target, evidence, and proposed content before applying this dream proposal."}
                </SheetDescription>
              </SheetHeader>

              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-5 p-5">
                  {previewQuery.error ? (
                    <QueryState
                      error={previewQuery.error}
                      label="Could not preview proposal"
                    />
                  ) : null}
                  {previewQuery.isLoading ? <ProposalSkeleton /> : null}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Target
                      </div>
                      <div className="mt-1 break-all font-mono text-xs text-foreground">
                        {preview?.target?.path || proposalTarget(proposal)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge variant="outline">
                          {preview?.target?.type ||
                            proposal.targetType ||
                            "memory"}
                        </Badge>
                        {preview?.targetExists ? (
                          <Badge variant="secondary">Existing target</Badge>
                        ) : (
                          <Badge variant="secondary">New target</Badge>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border bg-muted/20 p-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Review gate
                      </div>
                      <div className="mt-1 text-xs leading-relaxed text-foreground">
                        {preview?.approval?.willRequestApproval
                          ? "Applying will create a Dispatch approval request."
                          : needsApproval
                            ? "Applying writes a shared/workspace resource because approvals are disabled."
                            : "Applying writes personal memory directly."}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {proposal.risk ? (
                          <Badge variant="outline" className="capitalize">
                            {proposal.risk} risk
                          </Badge>
                        ) : null}
                        {proposal.confidence != null ? (
                          <Badge variant="outline">
                            {proposal.confidence}% confidence
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {proposal.rationale ? (
                    <div>
                      <div className="text-xs font-medium text-foreground">
                        Rationale
                      </div>
                      <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {proposal.rationale}
                      </div>
                    </div>
                  ) : null}

                  <Separator />

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <div className="mb-2 text-xs font-medium text-foreground">
                        Current target
                      </div>
                      {preview?.currentContent ? (
                        <RawBlock value={preview.currentContent} />
                      ) : (
                        <EmptyPanel
                          title="No existing content"
                          description="This proposal would create a new target or append to an empty target."
                        />
                      )}
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium text-foreground">
                        Proposed content
                      </div>
                      <RawBlock
                        value={preview?.proposedContent || proposal.content}
                      />
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <div className="mb-2 text-xs font-medium text-foreground">
                      Evidence
                    </div>
                    {sourceRunIds.length > 0 ? (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {sourceRunIds.map((id) => (
                          <Badge
                            key={id}
                            variant="outline"
                            className="font-mono"
                          >
                            {id}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {evidence.length > 0 ? (
                      <div className="space-y-2">
                        {evidence.map((item, index) => (
                          <div
                            key={item.id || `${proposal.id}-review-${index}`}
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
                              {item.quote ||
                                item.snippet ||
                                item.summary ||
                                "No text"}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyPanel
                        title="No structured evidence"
                        description="The proposal did not include compact evidence records."
                      />
                    )}
                  </div>

                  {canAct ? (
                    <div className="space-y-2">
                      <Label htmlFor={`reject-${proposal.id}`}>
                        Rejection reason
                      </Label>
                      <Textarea
                        id={`reject-${proposal.id}`}
                        value={rejectReason}
                        onChange={(event) =>
                          setRejectReason(event.target.value)
                        }
                        placeholder="Optional note for the audit log"
                      />
                    </div>
                  ) : null}
                </div>
              </ScrollArea>

              <SheetFooter className="gap-2 border-t px-5 py-4">
                <Button
                  variant="outline"
                  disabled={!canAct || applying || rejecting}
                  onClick={() => {
                    onReject(rejectReason.trim() || undefined);
                    setOpen(false);
                  }}
                >
                  {rejecting ? (
                    <Spinner className="mr-1.5 size-3.5" />
                  ) : (
                    <IconX size={14} className="mr-1.5" />
                  )}
                  Reject
                </Button>
                <Button
                  disabled={!canAct || applying || rejecting}
                  onClick={() => {
                    onApply();
                    setOpen(false);
                  }}
                >
                  {applying ? (
                    <Spinner className="mr-1.5 size-3.5" />
                  ) : (
                    <IconCheck size={14} className="mr-1.5" />
                  )}
                  {needsApproval ? "Request approval" : "Apply"}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedDreamId, setSelectedDreamId] = useState<string | null>(
    searchParams.get("dreamId"),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<DreamSettingsDraft>(() =>
    dreamSettingsToDraft(null),
  );

  const dreamsQuery = useActionQuery<ListDreamsResponse>(
    "list-dreams",
    { limit: 25 },
    { staleTime: 15_000 },
  );
  const candidatesQuery = useActionQuery<ListCandidatesResponse>(
    "list-dream-candidates",
    {
      limit: 25,
      sourceTimeoutMs: 30_000,
      sourceConcurrency: 2,
      sourceStartStaggerMs: 250,
      threadConcurrency: 3,
      threadTimeoutMs: 8_000,
    },
    { staleTime: 15_000 },
  );
  const dreamSettingsQuery = useActionQuery<DreamSettings>(
    "get-dream-settings",
    {},
    { staleTime: 30_000 },
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
  const candidateSourceHealth = useMemo(
    () => normalizeSourceHealth(candidatesQuery.data),
    [candidatesQuery.data],
  );

  useEffect(() => {
    const urlDreamId = searchParams.get("dreamId");
    if (urlDreamId && urlDreamId !== selectedDreamId) {
      setSelectedDreamId(urlDreamId);
      return;
    }
    if (selectedDreamId && dreams.some((dream) => dream.id === selectedDreamId))
      return;
    const nextId = dreams[0]?.id ?? null;
    setSelectedDreamId(nextId);
    if (nextId && nextId !== urlDreamId) {
      const next = new URLSearchParams(searchParams);
      next.set("dreamId", nextId);
      setSearchParams(next, { replace: true });
    }
  }, [dreams, searchParams, selectedDreamId, setSearchParams]);

  function selectDream(dreamId: string) {
    setSelectedDreamId(dreamId);
    const next = new URLSearchParams(searchParams);
    next.set("dreamId", dreamId);
    setSearchParams(next, { replace: true });
  }

  const createDream = useActionMutation<
    CreateDreamReportResult,
    CreateDreamReportParams
  >("create-dream-report", {
    onSuccess: (result) => {
      const nextId = resultDreamId(result);
      if (nextId) selectDream(nextId);
      toast.success("Dream report created");
    },
    onError: (err) => toast.error(String(err)),
  });

  const applyProposal = useActionMutation<unknown, ProposalMutationParams>(
    "apply-dream-proposal",
    {
      onSuccess: (result) => {
        toast.success(
          isApprovalRequestResult(result)
            ? "Approval requested"
            : "Proposal applied",
        );
        dreamDetailQuery.refetch();
        dreamsQuery.refetch();
      },
      onError: (err) => toast.error(String(err)),
    },
  );

  const rejectProposal = useActionMutation<unknown, ProposalMutationParams>(
    "reject-dream-proposal",
    {
      onSuccess: () => {
        toast.success("Proposal rejected");
        dreamDetailQuery.refetch();
        dreamsQuery.refetch();
      },
      onError: (err) => toast.error(String(err)),
    },
  );
  const ensureDreamSchedule = useActionMutation<
    unknown,
    Partial<DreamSettings>
  >("ensure-dream-job", {
    onSuccess: () => {
      toast.success("Dream schedule updated");
      dreamSettingsQuery.refetch();
    },
    onError: (err) => toast.error(String(err)),
  });
  const saveDreamSettings = useActionMutation<
    DreamSettings,
    Partial<DreamSettings>
  >("set-dream-settings", {
    onSuccess: (settings) => {
      toast.success("Dream settings saved");
      setSettingsDraft(dreamSettingsToDraft(settings));
      setSettingsOpen(false);
      dreamSettingsQuery.refetch();
      candidatesQuery.refetch();
    },
    onError: (err) => toast.error(String(err)),
  });

  const detail = dreamDetailQuery.data ?? null;
  const dreamSettings = dreamSettingsQuery.data ?? null;
  const selectedDream =
    detail?.dream ?? dreams.find((dream) => dream.id === selectedDreamId);
  const proposals: DreamProposal[] = detail?.proposals ?? [];
  const inspectedRuns: CandidateRun[] =
    detail?.inspectedRuns ?? detail?.candidates ?? [];
  const evidenceItems: DreamEvidence[] = detail?.evidence ?? [];
  const selectedSourceHealth: DreamSourceHealth[] =
    selectedDream?.sourceHealth ?? [];
  const pendingProposalCount = proposals.filter(
    (proposal) =>
      String(proposal.status || "pending").toLowerCase() === "pending",
  ).length;
  const appliedProposalCount = proposals.filter(
    (proposal) => String(proposal.status || "").toLowerCase() === "applied",
  ).length;

  useEffect(() => {
    if (dreamSettings && !settingsOpen) {
      setSettingsDraft(dreamSettingsToDraft(dreamSettings));
    }
  }, [dreamSettings, settingsOpen]);

  function handleSettingsOpenChange(open: boolean) {
    if (open) {
      setSettingsDraft(dreamSettingsToDraft(dreamSettings));
    }
    setSettingsOpen(open);
  }

  function saveSettings() {
    const update = dreamSettingsUpdateFromDraft(settingsDraft);
    if (!update.schedule) {
      toast.error("Add a cron schedule before saving");
      return;
    }
    saveDreamSettings.mutate(update);
  }

  function runDream(scanAllSources = false) {
    createDream.mutate({
      sourceId: scanAllSources ? "all" : "current",
      allSources: scanAllSources,
      limit: scanAllSources
        ? 8
        : candidates.length > 0
          ? candidates.length
          : 20,
      sourceTimeoutMs: dreamSettings?.sourceTimeoutMs ?? 30_000,
      sourceConcurrency: dreamSettings?.sourceConcurrency ?? 2,
      sourceStartStaggerMs: dreamSettings?.sourceStartStaggerMs ?? 250,
      threadConcurrency: dreamSettings?.threadConcurrency ?? 3,
      threadTimeoutMs: dreamSettings?.threadTimeoutMs ?? 8_000,
    });
  }

  function ensureSchedule() {
    ensureDreamSchedule.mutate({
      schedule: dreamSettings?.schedule,
      sourceId: dreamSettings?.sourceId ?? "all",
      sourceIds: dreamSettings?.sourceIds,
      allSources: dreamSettings?.allSources ?? true,
      query: dreamSettings?.query ?? undefined,
      limit: dreamSettings?.limit ?? 8,
      sourceTimeoutMs: dreamSettings?.sourceTimeoutMs ?? 30_000,
      sourceConcurrency: dreamSettings?.sourceConcurrency ?? 2,
      sourceStartStaggerMs: dreamSettings?.sourceStartStaggerMs ?? 250,
      threadConcurrency: dreamSettings?.threadConcurrency ?? 3,
      threadTimeoutMs: dreamSettings?.threadTimeoutMs ?? 8_000,
      minCandidateCount: dreamSettings?.minCandidateCount ?? 1,
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
          <div className="flex shrink-0 flex-wrap gap-2">
            {dreamSettings ? (
              <Badge variant="outline" className="h-9 px-3">
                {dreamSettings.enabled ? "Enabled" : "Paused"} ·{" "}
                {dreamSettings.allSources
                  ? "All sources"
                  : dreamSettings.sourceId}{" "}
                · {dreamSettings.schedule}
              </Badge>
            ) : null}
            <DreamSettingsSheet
              open={settingsOpen}
              onOpenChange={handleSettingsOpenChange}
              draft={settingsDraft}
              onDraftChange={setSettingsDraft}
              onSave={saveSettings}
              saving={saveDreamSettings.isPending}
              loading={dreamSettingsQuery.isLoading}
            />
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
            <Button
              variant="outline"
              onClick={ensureSchedule}
              disabled={ensureDreamSchedule.isPending}
            >
              {ensureDreamSchedule.isPending ? (
                <Spinner className="mr-1.5 size-3.5" />
              ) : (
                <IconCalendarTime size={15} className="mr-1.5" />
              )}
              Ensure schedule
            </Button>
            <Button
              variant="outline"
              onClick={() => runDream(true)}
              disabled={createDream.isPending}
            >
              {createDream.isPending ? (
                <Spinner className="mr-1.5 size-3.5" />
              ) : (
                <IconDatabase size={15} className="mr-1.5" />
              )}
              Run all sources
            </Button>
            <Button
              onClick={() => runDream(false)}
              disabled={createDream.isPending}
            >
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
                          onClick={() => selectDream(dream.id)}
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
                            onReject={(reason) =>
                              rejectProposal.mutate({
                                id: proposal.id,
                                reason,
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
                    {selectedSourceHealth.length > 0 ? (
                      <div className="mb-4">
                        <SourceHealthPanel sources={selectedSourceHealth} />
                      </div>
                    ) : null}
                    {inspectedRuns.length > 0 || evidenceItems.length ? (
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
                        {evidenceItems.map((item, index) => (
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
              {!candidatesQuery.isLoading &&
              !candidatesQuery.error &&
              candidateSourceHealth.length > 0 ? (
                <div className="mb-3">
                  <SourceHealthPanel sources={candidateSourceHealth} />
                </div>
              ) : null}
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
